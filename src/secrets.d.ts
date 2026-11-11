// Secrets aren't in wrangler.jsonc, so `wrangler types` can't see them.
interface Env {
  FROM_ADDRESS: string;
  TO_ADDRESS: string;
}
