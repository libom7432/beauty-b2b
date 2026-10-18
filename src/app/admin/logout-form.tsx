"use client";
import { useActionState } from "react";
import { logoutAction } from "./actions";

export function LogoutForm() {
  const [state, action, pending] = useActionState(logoutAction, null);
  return <form action={action}>
    <button type="submit" className="underline" disabled={pending}>Sign out</button>
    {state === "failed" && <p role="alert">Unable to sign out. Please try again or contact an administrator.</p>}
  </form>;
}
