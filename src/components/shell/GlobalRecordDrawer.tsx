import { useSearchParams } from "react-router-dom";
import { DRAWER_PARAM, parseDrawerParam } from "../../lib/routes";
import { appPack } from "../../domain/pack";
import { RecordInspector } from "../resource/RecordInspector";

/**
 * Record drawer over any page (`?drawer=<slug>:<id>`): clicking a related record — e.g. the client on a lead —
 * opens it here while the page behind stays put. Closing removes only the param.
 */
export function GlobalRecordDrawer() {
  const [params, setParams] = useSearchParams();
  const target = parseDrawerParam(params.get(DRAWER_PARAM));
  if (!target || !appPack.resources.some((r) => r.key === target.resKey))
    return null;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete(DRAWER_PARAM);
    setParams(next);
  };
  return (
    <RecordInspector
      key={`${target.resKey}:${target.id}`}
      resKey={target.resKey}
      recordId={target.id}
      onClose={close}
    />
  );
}
