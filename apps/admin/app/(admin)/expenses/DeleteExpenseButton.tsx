"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, toast } from "@hardware/ui";
import { deleteExpenseAction } from "./actions";

/**
 * Two-step delete, no modal. An expense is a private register entry, not a document a
 * customer holds, so removing a typo should be quick — but not one stray click quick.
 * The row's full contents are snapshotted into the audit log server-side first.
 */
export function DeleteExpenseButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();

  if (!armed) {
    return (
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setArmed(true)}>
        Delete
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await deleteExpenseAction(id);
            if (res.error) {
              toast.error(res.error);
              setArmed(false);
            } else {
              toast.success(`${label} deleted`);
              router.refresh();
            }
          })
        }
      >
        Sure?
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
        No
      </Button>
    </span>
  );
}
