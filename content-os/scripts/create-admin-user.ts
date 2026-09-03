import { hashPassword } from "@/lib/admin/password"

// Standalone helper -- run via:
//   npx tsx scripts/create-admin-user.ts <email> <password> <name>
// Hashes the given password with the same scrypt implementation the admin
// login route verifies against (lib/admin/password.ts) and prints a
// ready-to-paste INSERT statement. Deliberately does NOT touch the
// database itself -- admin_users has RLS enabled with no policies (see
// supabase/migrations/048_admin_users.sql), so only the service-role
// client can ever write to it; provisioning a new admin account is a
// manual "run this script, paste the SQL into the Supabase SQL Editor"
// step, not an automated one.

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

async function main() {
  const [email, password, name] = process.argv.slice(2)
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-admin-user.ts <email> <password> <name>")
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)
  const emailLiteral = `'${escapeSqlString(email)}'`
  const nameLiteral = name ? `'${escapeSqlString(name)}'` : "NULL"

  console.log(
    `INSERT INTO public.admin_users (email, password_hash, name) VALUES (${emailLiteral}, '${passwordHash}', ${nameLiteral});`
  )
}

main()
