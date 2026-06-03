import { Form, redirect, useActionData, Link } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { users } from "../db/schema";
import { verifyPassword, commitSession, getSession } from "../utils/auth";
import { eq } from "drizzle-orm";

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "請輸入 Email 與密碼" };
  }

  const env = context.cloudflare.env as any;
  const db = drizzle(env.DB);

  // 尋找使用者
  const user = await db.select().from(users).where(eq(users.email, email)).get();
  
  if (!user) {
    return { error: "Email 或密碼錯誤" };
  }

  // 驗證密碼
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return { error: "Email 或密碼錯誤" };
  }

  // 建立登入 Session
  const session = await getSession(request);
  session.set("userId", user.id);

  return redirect("/settings", {
    headers: {
      "Set-Cookie": await commitSession(session),
    },
  });
}

import { AppLayout } from "../components/AppLayout";

export default function LoginRoute() {
  const actionData = useActionData<{ error?: string }>();

  return (
    <AppLayout>
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
        <div className="w-full max-w-md p-8 bg-[#E4E3E0] rounded-sm shadow-xl border border-[#141414]">
          <h2 className="text-3xl font-serif italic tracking-tight text-[#141414] mb-6 text-center">登入交易平台</h2>
          
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
                placeholder="請輸入您的密碼"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-[#141414] hover:bg-black text-[#E4E3E0] font-bold rounded-sm transition-colors mt-6 border border-[#141414]"
            >
              登入系統
            </button>
          </Form>
          
          <div className="mt-6 text-center text-sm text-[#141414]">
            還沒有帳號嗎？{" "}
            <Link to="/register" className="font-bold underline hover:text-black">
              點此註冊
            </Link>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
