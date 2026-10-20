import { useRef, useState, type ReactNode } from "react";
import type { RecordData, ResourceDefinition } from "../../metadata/types";
import { cx } from "../../lib/format";
import type { Actor } from "../../services/authz";
import { getDb } from "../../services/db";
import { getMaster } from "../../services/registry";
import {
  availableTransitions,
  recordTitle,
  transitionRecord,
} from "../../services/runtime";
import { ServiceError } from "../../services/types";
import { Button } from "../primitives/Button";
import { StatusChip, useToast } from "../primitives/feedback";
import { Icon } from "../primitives/Icon";
import { confirmAction, Menu } from "../primitives/overlay";
import { getStageMoveHandler } from "./extensions";
import { L } from "../../constants/labels";

type Transition = ReturnType<typeof availableTransitions>[number];

/** One move the user can make from the record's current state: a lifecycle transition or a data-capturing dialog. */
export interface StageMove {
  to: string;
  label: string;
  disabledReason?: string;
}

/** Moves offered for a record: guarded lifecycle transitions plus the dialogs a module registers (Qualified, Lost …). */
export function stageMovesFor(
  res: ResourceDefinition,
  actor: Actor,
  record: RecordData,
): StageMove[] {
  if (!res.lifecycle) return [];
  const field = res.fields.find((f) => f.key === res.lifecycle!.field)!;
  const labelOf = (k: string) =>
    getMaster(field.master!).values.find((v) => v.key === k)?.label ?? k;
  const handled =
    getStageMoveHandler(res.key)?.targets({ res, actor, record }) ?? [];
  const moves: StageMove[] = handled.map((to) => ({ to, label: labelOf(to) }));
  availableTransitions(actor, res, record).forEach(
    (t) =>
      !handled.includes(t.to) &&
      moves.push({
        to: t.to,
        label: labelOf(t.to),
        disabledReason: t.disabledReason,
      }),
  );
  const order = getMaster(field.master!).values.map((v) => v.key);
  return moves.sort((a, b) => order.indexOf(a.to) - order.indexOf(b.to));
}

/**
 * Runs a status / stage move: opens the module's dialog when it owns the target, otherwise the guarded
 * lifecycle transition (with its confirmation). Render `dialog` once next to the control that calls `move`.
 */
export function useStageMove(res: ResourceDefinition, actor: Actor) {
  const toast = useToast();
  const [pending, setPending] = useState<{
    record: RecordData;
    to: string;
  } | null>(null);
  const handler = getStageMoveHandler(res.key);
  const field = res.lifecycle
    ? res.fields.find((f) => f.key === res.lifecycle!.field)
    : undefined;
  const labelOf = (k: string) =>
    field
      ? (getMaster(field.master!).values.find((v) => v.key === k)?.label ?? k)
      : k;

  const move = (record: RecordData, to: string) => {
    if (!res.lifecycle || record[res.lifecycle.field] === to) return;
    if (handler?.targets({ res, actor, record }).includes(to))
      return setPending({ record, to });
    const t = availableTransitions(actor, res, record).find((x) => x.to === to);
    if (!t)
      return toast(
        L.common.list.notAllowedStep(record.id, labelOf(to)),
        "danger",
      );
    if (t.disabledReason) return toast(t.disabledReason, "danger");
    const go = () => {
      try {
        const raw = getDb().records[res.key].find((x) => x.id === record.id);
        transitionRecord(
          actor,
          res.key,
          record.id,
          to,
          raw?.version ?? record.version,
        );
        toast(
          L.common.toasts.moved(
            recordTitle(res.key, record.id, actor),
            labelOf(to),
          ),
        );
      } catch (e) {
        toast(
          e instanceof ServiceError ? e.message : L.common.toasts.moveFailed,
          "danger",
        );
      }
    };
    if (t.confirm)
      confirmAction({
        title: `${t.action}?`,
        message: t.confirm,
        tone: "primary",
        confirmLabel: L.common.actions.confirm,
        onConfirm: go,
      });
    else go();
  };

  const dialog: ReactNode =
    pending && handler ? (
      <handler.Dialog
        res={res}
        actor={actor}
        record={pending.record}
        to={pending.to}
        onClose={() => setPending(null)}
      />
    ) : null;
  return { move, dialog };
}

/**
 * List-view status cell: the status chip is itself the control — click it to pick the next status.
 * Statuses that need details (Qualified, Lost …) open their dialog. Read-only chip when no move is possible.
 */
export function StatusCellMenu({
  res,
  actor,
  record,
  move,
}: {
  res: ResourceDefinition;
  actor: Actor;
  record: RecordData;
  move: (r: RecordData, to: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const field = res.fields.find((f) => f.key === res.lifecycle!.field)!;
  const current = getMaster(field.master!).values.find(
    (v) => v.key === record[field.key],
  );
  const moves = stageMovesFor(res, actor, record);
  const chip = (
    <StatusChip
      label={current?.label ?? String(record[field.key] ?? "")}
      tone={current?.tone}
    />
  );
  if (!moves.length) return chip;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx("status-cell-btn", open && "is-open")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={L.common.list.changeField(field.label)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {chip}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <Menu
          open
          onClose={() => setOpen(false)}
          anchor={ref}
          align="start"
          label={L.common.list.changeField(field.label)}
          items={moves.map((m) => ({
            id: m.to,
            label: m.label,
            icon: "chevron-right",
            disabledReason: m.disabledReason,
            onSelect: () => move(record, m.to),
          }))}
        />
      )}
    </>
  );
}

/**
 * One labelled "Change Stage ▾" button listing the lifecycle moves the BRD flow allows from the record's
 * current state. Used in the record drawer only — lists and boards change status in place (drag / status cell).
 */
export function MoveStageButton({
  res,
  actor,
  record,
  onRun,
  className,
}: {
  res: ResourceDefinition;
  actor: Actor;
  record: RecordData;
  onRun?: (t: Transition) => void;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  if (!res.lifecycle) return null;
  const transitions = availableTransitions(actor, res, record);
  if (!transitions.length) return null;
  const fieldLabel =
    res.fields.find((f) => f.key === res.lifecycle!.field)?.label ?? "";

  const run = (t: Transition) => {
    if (onRun) return onRun(t);
    const go = () => {
      try {
        const raw = getDb().records[res.key].find((x) => x.id === record.id);
        transitionRecord(
          actor,
          res.key,
          record.id,
          t.to,
          raw?.version ?? record.version,
        );
        toast(
          L.common.toasts.actionDone(
            recordTitle(res.key, record.id, actor),
            t.action,
          ),
        );
      } catch (e) {
        toast(
          e instanceof ServiceError ? e.message : L.common.toasts.actionFailed,
          "danger",
        );
      }
    };
    if (t.confirm)
      confirmAction({
        title: `${t.action}?`,
        message: t.confirm,
        tone: "primary",
        confirmLabel: L.common.actions.confirm,
        onConfirm: go,
      });
    else go();
  };

  return (
    <>
      <Button
        ref={ref}
        iconRight="chevron-down"
        className={cx("move-stage-btn", className)}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {L.common.list.changeField(fieldLabel)}
      </Button>
      {open && (
        <Menu
          open
          onClose={() => setOpen(false)}
          anchor={ref}
          align="start"
          label={L.common.list.changeField(fieldLabel)}
          items={transitions.map((t) => ({
            id: t.to,
            label: t.action,
            icon: "chevron-right",
            disabledReason: t.disabledReason,
            onSelect: () => run(t),
          }))}
        />
      )}
    </>
  );
}
