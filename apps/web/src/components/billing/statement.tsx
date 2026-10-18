"use client";

import { Printer, Undo2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/surface";
import type { Schemas } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

import { Money, PAYMENT_METHOD, TX_KIND } from "./money";

type Tx = Schemas["Transaction"];

/** Bank-statement style ledger (newest first). Contains no patient information. */
export function Statement({ rows, receiptScope, onReverse }: {
  rows: Tx[]; receiptScope: "admin" | "me"; onReverse?: (tx: Tx) => void;
}) {
  if (!rows.length) return <EmptyState title="لا توجد عمليات بعد" description="ستظهر هنا الرسوم والدفعات بترتيب زمني." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-sunken text-xs text-muted">
          <tr>
            <th className="px-3 py-2.5 text-start font-medium">التاريخ</th>
            <th className="px-3 py-2.5 text-start font-medium">العملية</th>
            <th className="px-3 py-2.5 text-end font-medium">المبلغ</th>
            <th className="px-3 py-2.5 text-end font-medium">الرصيد بعدها</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((tx) => (
            <tr key={tx.id} className={tx.is_reversed ? "opacity-60" : undefined}>
              <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(tx.occurred_at)}</td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{TX_KIND[tx.kind] ?? tx.kind}</span>
                  {tx.payment_method && <Badge>{PAYMENT_METHOD[tx.payment_method] ?? tx.payment_method}</Badge>}
                  {tx.is_reversed && <Badge tone="danger">معكوسة</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {tx.description}
                  {tx.organization_name && ` · ${tx.organization_name}`}
                  {tx.reference && <> · مرجع <span className="num">{tx.reference}</span></>}
                  {tx.created_by_name && ` · بواسطة ${tx.created_by_name}`}
                </div>
              </td>
              <td className="px-3 py-3 text-end"><Money value={tx.amount} currency={tx.currency} signed colored /></td>
              <td className="px-3 py-3 text-end"><Money value={tx.balance_after} currency={tx.currency} /></td>
              <td className="px-3 py-3 text-end">
                <div className="flex justify-end gap-1">
                  {tx.kind === "payment" && (
                    <Button asChild variant="ghost" size="icon" aria-label="الإيصال">
                      <Link href={`/print/receipt/${tx.id}?scope=${receiptScope}`} target="_blank"><Printer className="size-4" /></Link>
                    </Button>
                  )}
                  {onReverse && !tx.is_reversed && tx.kind !== "reversal" && (
                    <Button variant="ghost" size="icon" aria-label="عكس العملية" onClick={() => onReverse(tx)}><Undo2 className="size-4" /></Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
