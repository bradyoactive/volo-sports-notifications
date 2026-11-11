import { findNewVoloPickups } from "./notify";

export default {
  scheduled: async (_controller, env) => {
    await findNewVoloPickups(env);
  },
} satisfies ExportedHandler<Env>;
