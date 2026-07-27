"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input, formatQty, toast } from "@hardware/ui";
import { setStockLevelAction, type ActionState } from "./actions";

// Inline-editable on-hand cell for the stock list. Display mode shows the
// formatted quantity with a small Edit affordance; edit mode swaps in a numeric
// input + Save/Cancel. Saving just sends the new absolute count — the server
// records the +/- difference as a ledger adjustment (reason "Manual stock edit"),
// so on-hand stays fully audited even though the operator only typed a number.
export function EditableStock({
  productId,
  onHand,
  baseUnitCode,
}: {
  productId: string;
  onHand: string;
  baseUnitCode: string;
}) {
  const t = useTranslations("stock");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(onHand);
  const inputRef = useRef<HTMLInputElement>(null);

  const [, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await setStockLevelAction(prev, fd);
    if (result.ok) {
      toast.success(t("list.stockUpdated"));
      setEditing(false);
      router.refresh();
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, {});

  // Reset the draft to the freshest server value whenever we (re)open the editor.
  useEffect(() => {
    if (editing) {
      setValue(onHand);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, onHand]);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums">{formatQty(onHand)}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}
          aria-label={t("list.editStockAria")}
        >
          {t("list.editStock")}
        </Button>
      </span>
    );
  }

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <input type="hidden" name="productId" value={productId} />
      <Input
        ref={inputRef}
        name="onHand"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        className="h-8 w-24 tabular-nums"
        aria-label={t("list.editStockAria")}
      />
      <span className="text-xs text-muted-foreground">{baseUnitCode}</span>
      <Button type="submit" size="sm" className="h-8 px-2 text-xs" isLoading={pending}>
        {t("list.saveStock")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => setEditing(false)}
        disabled={pending}
      >
        {t("list.cancelStock")}
      </Button>
    </form>
  );
}
