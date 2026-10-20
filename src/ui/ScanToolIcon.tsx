import { GeneratedIcon } from "./GeneratedIcon";
import "./ScanToolIcon.css";
export type ScanIconName =
  | "wand"
  | "brush"
  | "freehand"
  | "line"
  | "rectangle"
  | "circle"
  | "through"
  | "grow"
  | "shrink"
  | "boundary"
  | "all"
  | "isolate"
  | "hide"
  | "reveal"
  | "revealSelected"
  | "invert"
  | "clear"
  | "clip"
  | "save"
  | "cut"
  | "copy"
  | "delete"
  | "smooth"
  | "defeature"
  | "split"
  | "components"
  | "connected"
  | "holes"
  | "boundaries";

export function ScanToolIcon({
  name,
  size = 22,
}: {
  name: ScanIconName;
  size?: number;
}) {
  return (
    <GeneratedIcon
      asset={`scan-${name}`}
      size={size}
      className="scan-feature-icon"
      data-scan-icon={name}
    />
  );
}
