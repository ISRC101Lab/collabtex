import { resolveDataDir } from "../server/lib/paths.js";
import { loadUsers } from "../server/lib/users.js";

async function main() {
  const dataDir = resolveDataDir();
  const db = await loadUsers(dataDir);
  for (const u of db.users) {
    console.log(`${u.username}\t${u.isAdmin ? "admin" : "user"}\t${u.createdAt || ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

