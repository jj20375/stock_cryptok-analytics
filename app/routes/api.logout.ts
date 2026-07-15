import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { destroySession, getSession } from "../utils/auth";

export async function action({ request, context }: ActionFunctionArgs) {
  const env = (context.cloudflare as any)?.env || process.env;
  const session = await getSession(request, env);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await destroySession(session, env),
    },
  });
}

// 防呆機制：如果是 GET 請求也直接登出並導向登入頁面
export async function loader({ request, context }: ActionFunctionArgs) {
  const env = (context.cloudflare as any)?.env || process.env;
  const session = await getSession(request, env);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await destroySession(session, env),
    },
  });
}
