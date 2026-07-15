import { Form, redirect, useActionData, Link } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../db/schema";
import { hashPassword, commitSession, getSession } from "../utils/auth";
import { eq } from "drizzle-orm";

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const invitationCode = formData.get("invitationCode") as string;

  // 基本驗證
  if (!email || !password || !invitationCode) {
    return { error: "所有欄位皆為必填" };
  }

  const env = context.cloudflare.env as any;

  // 邀請碼驗證
  if (invitationCode !== env.INVITATION_CODE) {
    return { error: "邀請碼錯誤" };
  }

  const db = drizzle(env.DB);

  // 檢查是否已存在
  const existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  if (existingUser) {
    return { error: "該 Email 已經被註冊" };
  }

  // 建立帳號
  const passwordHash = await hashPassword(password);
  
  const result = await db.insert(users).values({
    email,
    passwordHash
  }).returning();

  const newUser = result[0];

  // 建立登入 Session
  const session = await getSession(request, env);
  session.set("userId", newUser.id);

  return redirect("/settings", {
    headers: {
      "Set-Cookie": await commitSession(session, env),
    },
  });
}

import { AppLayout } from "../components/AppLayout";

export default function RegisterRoute() {
  const actionData = useActionData<{ error?: string }>();

  return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
        <div className="w-full max-w-md p-8 bg-[#E4E3E0] rounded-sm shadow-xl border border-[#141414]">
          <h2 className="text-3xl font-serif italic tracking-tight text-[#141414] mb-6 text-center">註冊交易平台帳號</h2>
          
          {actionData?.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-600 text-red-800 rounded-sm text-sm font-medium">
              {actionData.error}
            </div>
          )}

          <Form method="post" className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-[#141414] mb-1">Email 信箱</label>
              <input
                type="email"
                name="email"
                required
                className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#141414] placeholder-gray-400"
                placeholder="your@email.com"
              />
            </div>
            
            <div>
              <label className="block text-sm font-bold text-[#141414] mb-1">密碼</label>
              <input
                type="password"
                name="password"
                required
                className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#141414] placeholder-gray-400"
                placeholder="請輸入您的密碼 (至少 8 碼)"
                minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#141414] mb-1">邀請碼</label>
              <input
                type="text"
                name="invitationCode"
                required
                className="w-full px-4 py-2 bg-white border border-[#141414] rounded-sm text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#141414] placeholder-gray-400"
                placeholder="請輸入系統管理員提供的邀請碼"
              />
              <p className="text-xs text-gray-500 mt-1">目前僅開放持有邀請碼的使用者註冊。</p>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-[#141414] hover:bg-black text-[#E4E3E0] font-bold rounded-sm transition-colors mt-6 border border-[#141414]"
            >
              建立帳號
            </button>
          </Form>
          
          <div className="mt-6 text-center text-sm text-[#141414]">
            已經有帳號了嗎？{" "}
            <Link to="/login" className="font-bold underline hover:text-black">
              點此登入
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
