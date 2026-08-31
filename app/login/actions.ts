"use server";

import { redirect } from "next/navigation";
import { createSession } from "@/lib/session";

export async function login(formData: FormData) {
  const password = formData.get("password");
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    redirect("/login?error=config");
  }
  if (typeof password !== "string" || password !== expected) {
    redirect("/login?error=1");
  }

  await createSession();
  redirect("/");
}
