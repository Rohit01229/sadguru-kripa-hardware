"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  toast,
} from "@hardware/ui";
import {
  addSaleUnitAction,
  archiveProductAction,
  unarchiveProductAction,
  type ActionState,
} from "../actions";

interface UnitOpt {
  id: string;
  code: string;
  kind: "MEASURED" | "PIECE";
}

export function AddSaleUnitForm({ productId, units }: { productId: string; units: UnitOpt[] }) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await addSaleUnitAction(productId, prev, fd);
    if (result.ok) {
      toast.success(t("addSaleUnit.toastAdded"));
      router.refresh();
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, {});

  return (
    <form
      action={formAction}
      className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
    >
      <div className="col-span-2 space-y-1 sm:col-auto">
        <Label htmlFor="add-su-unit" className="text-xs text-muted-foreground">
          {t("addSaleUnit.unit")}
        </Label>
        <Select id="add-su-unit" name="unitId" required className="w-full sm:w-40">
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} ({u.kind})
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="add-su-factor" className="text-xs text-muted-foreground">
          {t("addSaleUnit.factor")}
        </Label>
        <Input
          id="add-su-factor"
          name="factorToBase"
          defaultValue="1"
          inputMode="decimal"
          className="w-full sm:w-24"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="add-su-price" className="text-xs text-muted-foreground">
          {t("addSaleUnit.salePrice")}
        </Label>
        <Input
          id="add-su-price"
          name="salePrice"
          type="number"
          step="0.01"
          placeholder="0.00"
          required
          className="w-full sm:w-28"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="add-su-mrp" className="text-xs text-muted-foreground">
          {t("addSaleUnit.mrp")}
        </Label>
        <Input
          id="add-su-mrp"
          name="mrp"
          type="number"
          step="0.01"
          placeholder={t("addSaleUnit.mrpPlaceholder")}
          className="w-full sm:w-28"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        isLoading={pending}
        className="col-span-2 min-h-[2.75rem] w-full sm:col-auto sm:min-h-0 sm:w-auto"
      >
        {t("addSaleUnit.submit")}
      </Button>
      {state.error && (
        <span className="col-span-2 text-xs text-destructive sm:col-auto">{state.error}</span>
      )}
    </form>
  );
}

export function ArchiveButton({ productId, isActive }: { productId: string; isActive: boolean }) {
  const t = useTranslations("catalog");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const result = isActive
        ? await archiveProductAction(productId)
        : await unarchiveProductAction(productId);
      if (result.ok) {
        toast.success(isActive ? t("archive.toastArchived") : t("archive.toastRestored"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? t("archive.toastError"));
      }
    });
  }

  // Restore is non-destructive — act directly. Archive asks for confirmation.
  if (!isActive) {
    return (
      <Button variant="outline" isLoading={pending} onClick={run}>
        {t("archive.restore")}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="destructive">{t("archive.archive")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("archive.confirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("archive.confirmDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline">{tc("actions.cancel")}</Button>
          </DialogClose>
          <Button variant="destructive" isLoading={pending} onClick={run}>
            {t("archive.confirmAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
