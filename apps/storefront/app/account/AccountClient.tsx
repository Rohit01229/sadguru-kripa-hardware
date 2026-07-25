"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  StateCodePicker,
  toast,
} from "@hardware/ui";

interface Address {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}
interface Profile {
  name: string;
  phone: string | null;
  gstin: string | null;
  email: string;
  addresses: Address[];
}

// Account client: edit profile (name/phone/GSTIN) and add/remove addresses, calling
// the ownership-scoped /api/account routes.
export function AccountClient({ profile }: { profile: Profile }) {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [gstin, setGstin] = useState(profile.gstin ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // New address form (inside a Dialog)
  const [addrOpen, setAddrOpen] = useState(false);
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [addrError, setAddrError] = useState<string | null>(null);
  const [savingAddr, setSavingAddr] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: phone.trim() || null, gstin: gstin.trim() || null }),
    });
    setSavingProfile(false);
    if (res.ok) {
      toast.success(t("profile.savedToast"));
      router.refresh();
    } else {
      toast.error(t("profile.saveError"));
    }
  }

  async function addAddress() {
    setAddrError(null);
    setSavingAddr(true);
    const res = await fetch("/api/account/addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line1, city, state, pincode, isDefault: profile.addresses.length === 0 }),
    });
    setSavingAddr(false);
    if (res.ok) {
      setLine1("");
      setCity("");
      setState("");
      setPincode("");
      setAddrOpen(false);
      toast.success(t("addresses.addedToast"));
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setAddrError(data?.error?.message ?? t("addresses.addError"));
    }
  }

  async function removeAddress(id: string) {
    const res = await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("addresses.removedToast"));
    } else {
      toast.error(t("addresses.removeError"));
    }
    router.refresh();
  }

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("profile.title")}</CardTitle>
          <p className="text-xs text-muted-foreground">{profile.email}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label={t("profile.nameLabel")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("profile.namePlaceholder")} />
            </FormField>
            <FormField label={t("profile.phoneLabel")}>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("profile.phonePlaceholder")}
              />
            </FormField>
            <FormField label={t("profile.gstinLabel")} hint={t("profile.gstinHint")}>
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder={t("profile.gstinPlaceholder")} />
            </FormField>
          </div>
          <div>
            <Button onClick={saveProfile} isLoading={savingProfile}>
              {t("profile.saveProfile")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("addresses.title")}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAddrOpen(true)}>
            {t("addresses.addAddress")}
          </Button>
        </CardHeader>
        <CardContent>
          {profile.addresses.length === 0 ? (
            <EmptyState
              title={t("addresses.emptyTitle")}
              description={t("addresses.emptyDescription")}
              action={
                <Button size="sm" onClick={() => setAddrOpen(true)}>
                  {t("addresses.addAddress")}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y rounded-lg border">
              {profile.addresses.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      {a.line1}, {a.city} — {a.state} {a.pincode}
                    </span>
                    {a.isDefault && <Badge variant="outline">{t("addresses.defaultBadge")}</Badge>}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start text-destructive hover:text-destructive sm:self-auto"
                    onClick={() => removeAddress(a.id)}
                    aria-label={t("addresses.removeAddressLabel")}
                  >
                    {tc("actions.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={addrOpen} onOpenChange={setAddrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addresses.addAddress")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <FormField label={t("addresses.addressLineLabel")} required>
              <Input
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder={t("addresses.addressLinePlaceholder")}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label={t("addresses.cityLabel")} required>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("addresses.cityPlaceholder")} />
              </FormField>
              <FormField label={t("addresses.stateLabel")} required hint={t("addresses.stateHint")}>
                <StateCodePicker
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder={t("addresses.statePlaceholder")}
                />
              </FormField>
              <FormField label={t("addresses.pincodeLabel")} required>
                <Input
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value)}
                  placeholder={t("addresses.pincodePlaceholder")}
                />
              </FormField>
            </div>
            {addrError && <Alert variant="destructive" description={addrError} />}
          </div>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline" disabled={savingAddr}>
                {tc("actions.cancel")}
              </Button>
            </DialogClose>
            <Button onClick={addAddress} isLoading={savingAddr}>
              {t("addresses.addAddress")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
