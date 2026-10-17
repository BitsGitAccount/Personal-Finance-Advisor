import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { email, password, name, age, monthlySalary, cityTier } =
    await req.json();

  if (!email || !password || !age || !monthlySalary) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: name ?? null,
      passwordHash,
      age: Number(age),
      monthlySalary: Number(monthlySalary),
      cityTier: cityTier ?? "TIER_1",
    },
  });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
