import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.APPDOCK_ADMIN_USERNAME || "admin";
  const password =
    process.env.APPDOCK_ADMIN_PASSWORD || "change-me-on-first-boot";
  const email =
    process.env.APPDOCK_ADMIN_EMAIL || `${username}@localhost`;

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { username } });

  let admin;
  if (!existing) {
    admin = await prisma.user.create({
      data: {
        username,
        email,
        displayName: "Administrator",
        passwordHash,
        role: "admin",
        status: "active",
        mustChangePassword: true,
      },
    });
  } else if (existing.mustChangePassword) {
    // 尚未改密：同步 env 初始密码与 email，便于本地反复 seed
    admin = await prisma.user.update({
      where: { username },
      data: {
        email,
        passwordHash,
        role: "admin",
        status: "active",
        mustChangePassword: true,
      },
    });
  } else {
    // 已改密：幂等，不覆盖 hash / mustChangePassword
    admin = await prisma.user.update({
      where: { username },
      data: { email, role: "admin", status: "active" },
    });
  }

  console.log(
    `[seed] admin ready: ${admin.username} email=${admin.email} (mustChangePassword=${admin.mustChangePassword})`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
