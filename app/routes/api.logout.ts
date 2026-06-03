import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { destroySession, getSession } from "../utils/auth";

export async function action({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await destroySession(session),
    },
  });
}

// 防呆機制：如果是 GET 請求也直接登出並導向登入頁面
export async function loader({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await destroySession(session),
    },
  });
}
