"use client";
import { startTransition, useActionState, useCallback, useEffect, useRef, type FormEvent } from "react";
import { logoutAction } from "./actions";
import { useAdminUnsavedChanges } from "@/components/admin/admin-unsaved-changes";

export function LogoutForm({ onStart, onFailure }: {
  onStart?: () => void; onFailure?: () => void;
}) {
  // The server returns the same "failed" value on every failure. Give each
  // completed attempt a distinct action state so every retry can unlock.
  const logoutAttempt = useCallback(async (previousFailures: number) => {
    await logoutAction(null);
    return previousFailures + 1;
  }, []);
  const [failedAttempts, action, pending] = useActionState(logoutAttempt, 0);
  const { requestNavigation } = useAdminUnsavedChanges();
  const submitted = useRef(false);
  useEffect(() => {
    if (failedAttempts === 0 || !submitted.current) return;
    submitted.current = false;
    if (onFailure) queueMicrotask(onFailure);
  }, [failedAttempts, onFailure]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || submitted.current) return;
    const trigger = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    requestNavigation({ type: "SIGN_OUT", scope: "GLOBAL", target: "/admin/login",
      trigger, execute: () => {
        if (submitted.current) return;
        submitted.current = true;
        try {
          onStart?.();
          startTransition(() => action());
        } catch (error) {
          submitted.current = false;
          throw error;
        }
      } });
  };
  return <form action={action} onSubmit={submit}>
    <button type="submit" className="underline" disabled={pending}>Sign out</button>
    {failedAttempts > 0 && <p role="alert">Unable to sign out. Please try again or contact an administrator.</p>}
  </form>;
}
