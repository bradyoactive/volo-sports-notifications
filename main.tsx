import { blob } from "https://esm.town/v/std/blob";
import { email } from "https://esm.town/v/std/email";
import { TZDate } from "npm:@date-fns/tz";
import { format, getTime } from "npm:date-fns";
import { gql, request as graphqlRequest } from "npm:graphql-request";
// @deno-types="npm:@types/ramda"
import * as R from "npm:ramda";

declare module "npm:ramda" {
  export function groupBy<T>(
    fn: (a: T) => string,
  ): (list: readonly T[]) => Record<string, T[]>;
  export function groupBy<T>(
    fn: (a: T) => string,
    list: readonly T[],
  ): Record<string, T[]>;
}

type QueryResponse = {
  discover_daily: {
    _id: string;
    league: LeagueResponse;
  }[];
};

type LeagueResponse = {
  games: {
    start_time: string;
    end_time: string;
  }[];
  sportBySport: {
    name: string;
  };
  venueByVenue: {
    shorthand_name: string;
  };
};

type FinalEvent = {
  _id: string;
  sport: string;
  venue: string;
  start_time: TZDate;
  end_time: TZDate;
};

const SPORTS = ["Pickleball"];
const LOCATION = "New York Metro Area";
const TIME_ZONE = "America/New_York";

const query = gql`
query DiscoverDaily($where: discover_daily_bool_exp!, $limit: Int, $offset: Int) {
  discover_daily(
    where: $where
    order_by: [{event_start_date: asc}, {event_start_time_str: asc}, {event_end_time_str: asc}, {_id: asc}]
    limit: $limit
    offset: $offset
  ) {
    _id
    league {
      games {
        start_time
        end_time
      }
      sportBySport {
        name
      }
      venueByVenue {
        shorthand_name
      }
    }
  }
}
`;

export default async function findNewVoloPickups(_interval: Interval) {
  const upcomingEvents = await fetchUpcomingEvents();
  const seenEventIds = await getSeenEventIds();
  const eventsToNotify = R.reject(
    (event) => seenEventIds.has(event._id),
    upcomingEvents,
  );
  await notifyEvents(eventsToNotify);
  await saveNewSeenEvents(upcomingEvents);
}

async function notifyEvents(events: FinalEvent[]) {
  if (events.length === 0) {
    return;
  }
  const sortedEvents = R.sortBy((event) => getTime(event.start_time), events);
  const eventsBySport = R.groupBy(R.prop("sport"), sortedEvents);

  const lines: string[] = [];
  for (
    const [sport, events] of Object.entries(
      eventsBySport,
    )
  ) {
    lines.push(sport);
    const eventsByDay = R.groupBy(
      (event: FinalEvent) => format(event.start_time, "yyyy-MM-dd"),
      events,
    );
    for (const [day, events] of Object.entries(eventsByDay)) {
      lines.push(`  ${day}`);
      const eventsByVenue = R.groupBy(R.prop("venue"), events);
      for (const [venue, events] of Object.entries(eventsByVenue)) {
        lines.push(`    ${venue}`);
        for (const event of events) {
          lines.push(
            `      ${format(event.start_time, "h:mm a")} - ${
              format(event.end_time, "h:mm a")
            } https://www.volosports.com/d/${event._id}`,
          );
        }
      }
    }
  }

  const text = lines.join("\n");
  await email({ subject: "New Volo pickups!", text });
}

async function fetchUpcomingEvents(): Promise<FinalEvent[]> {
  const result = await graphqlRequest<QueryResponse>(
    "https://volosports.com/hapi/v1/graphql",
    query,
    {
      "limit": 100,
      "offset": 0,
      "where": {
        "game_id": {
          "_is_null": true,
        },
        "league_id": {
          "_is_null": false,
        },
        "league": {
          "organizationByOrganization": {
            "name": {
              "_eq": LOCATION,
            },
          },
          "private": {
            "_eq": false,
          },
          "archived": {
            "_eq": false,
          },
          "sportBySport": {
            "name": {
              "_in": SPORTS,
            },
          },
          "start_date": {
            "_gte": "now()",
          },
          "program_type": {
            "_in": [
              "PICKUP",
            ],
          },
          "status": {
            "_eq": "registration_open",
          },
          "registrationByRegistration": {
            "available_spots": {
              "_gte": 1,
            },
            "registration_close_date": {
              "_gte": "now()",
            },
          },
        },
      },
    },
  );
  return result.discover_daily.flatMap((event) => {
    const league = event.league;
    const game = league.games[0];
    return {
      _id: event._id,
      venue: league.venueByVenue.shorthand_name,
      sport: league.sportBySport.name,
      start_time: new TZDate(game.start_time, TIME_ZONE),
      end_time: new TZDate(game.end_time, TIME_ZONE),
    };
  });
}

async function getSeenEventIds(): Promise<Set<string>> {
  const seenEvents = await blob.getJSON<string[]>(
    "seenVoloPickupLeagueIds",
  );
  return new Set(seenEvents);
}

async function saveNewSeenEvents(upcomingEvents: FinalEvent[]) {
  const newSeenEventIds = R.map(R.prop("_id"), upcomingEvents);
  await blob.setJSON("seenVoloPickupLeagueIds", newSeenEventIds);
}
