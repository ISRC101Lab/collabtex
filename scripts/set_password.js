import { resolveDataDir } from "../server/lib/paths.js";
import { loadUsers, saveUsers, findUser } from "../server/lib/users.js";
import { hashPassword } from "../server/lib/passwords.js";

async function main() {
  const username = process.argv[2];
  const newPassword = process.argv[3];
  if (!username || !newPassword) {
    console.error("usage: node scripts/set_password.js <username> <new_password>");
    process.exit(2);
  }

  const dataDir = resolveDataDir();
  const db = await loadUsers(dataDir);
  const user = findUser(db, username);
  if (!user) {
    console.error(`user not found: ${username}`);
    process.exit(1);
  }

  user.password = await hashPassword(newPassword);
  await saveUsers(dataDir, db);
  console.log(`updated password for ${username} (dataDir=${dataDir})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

