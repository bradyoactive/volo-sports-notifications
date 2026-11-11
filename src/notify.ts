import { TZDate } from "@date-fns/tz";
import { EmailMessage } from "cloudflare:email";
import { format, getTime } from "date-fns";
import { gql, request as graphqlRequest } from "graphql-request";
import { createMimeMessage } from "mimetext";
import * as R from "ramda";

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
const VOLO_GRAPHQL_URL = "https://volosports.com/hapi/v1/graphql";
const SEEN_KEY = "seenVoloPickupLeagueIds";

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

export async function findNewVoloPickups(env: Env): Promise<void> {
  const upcomingEvents = await fetchUpcomingEvents();
  const seenEventIds = await getSeenEventIds(env);
  const eventsToNotify = upcomingEvents.filter(
    (event) => !seenEventIds.has(event._id),
  );
  await notifyEvents(env, eventsToNotify);
  await saveNewSeenEvents(env, upcomingEvents);
}

async function notifyEvents(env: Env, events: FinalEvent[]) {
  if (events.length === 0) {
    return;
  }
  const sortedEvents = R.sortBy((event) => getTime(event.start_time), events);
  const eventsBySport = R.groupBy((event: FinalEvent) => event.sport, sortedEvents);

  const lines: string[] = [];
  for (const [sport, sportEvents] of Object.entries(eventsBySport)) {
    lines.push(sport);
    const eventsByDay = R.groupBy(
      (event: FinalEvent) => format(event.start_time, "yyyy-MM-dd"),
      sportEvents ?? [],
    );
    for (const [day, dayEvents] of Object.entries(eventsByDay)) {
      lines.push(`  ${day}`);
      const eventsByVenue = R.groupBy((event: FinalEvent) => event.venue, dayEvents ?? []);
      for (const [venue, venueEvents] of Object.entries(eventsByVenue)) {
        lines.push(`    ${venue}`);
        for (const event of venueEvents ?? []) {
          lines.push(
            `      ${format(event.start_time, "h:mm a")} - ${
              format(event.end_time, "h:mm a")
            } https://www.volosports.com/d/${event._id}`,
          );
        }
      }
    }
  }

  await sendEmail(env, "New Volo pickups!", lines.join("\n"));
}

async function sendEmail(env: Env, subject: string, text: string) {
  if (!env.FROM_ADDRESS || !env.TO_ADDRESS) {
    throw new Error("Set the FROM_ADDRESS and TO_ADDRESS secrets (or .dev.vars locally)");
  }
  const msg = createMimeMessage();
  msg.setSender({ name: "Volo pickups", addr: env.FROM_ADDRESS });
  msg.setRecipient(env.TO_ADDRESS);
  msg.setSubject(subject);
  msg.addMessage({ contentType: "text/plain", data: text });

  await env.SEND_EMAIL.send(
    new EmailMessage(env.FROM_ADDRESS, env.TO_ADDRESS, msg.asRaw()),
  );
}

async function fetchUpcomingEvents(): Promise<FinalEvent[]> {
  const result = await graphqlRequest<QueryResponse>(
    VOLO_GRAPHQL_URL,
    query,
    {
      limit: 100,
      offset: 0,
      where: {
        game_id: { _is_null: true },
        league_id: { _is_null: false },
        league: {
          organizationByOrganization: { name: { _eq: LOCATION } },
          private: { _eq: false },
          archived: { _eq: false },
          sportBySport: { name: { _in: SPORTS } },
          start_date: { _gte: "now()" },
          program_type: { _in: ["PICKUP"] },
          status: { _eq: "registration_open" },
          registrationByRegistration: {
            available_spots: { _gte: 1 },
            registration_close_date: { _gte: "now()" },
          },
        },
      },
    },
  );
  return result.discover_daily.map((event) => {
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

async function getSeenEventIds(env: Env): Promise<Set<string>> {
  const seenEvents = await env.VOLO_SPORTS_NOTIFICATIONS.get<string[]>(SEEN_KEY, "json");
  return new Set(seenEvents ?? []);
}

async function saveNewSeenEvents(env: Env, upcomingEvents: FinalEvent[]) {
  const newSeenEventIds = upcomingEvents.map((event) => event._id);
  await env.VOLO_SPORTS_NOTIFICATIONS.put(SEEN_KEY, JSON.stringify(newSeenEventIds));
}
