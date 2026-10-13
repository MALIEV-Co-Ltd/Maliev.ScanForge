import type { ReactNode } from "react";
import "./ScanToolIcon.css";
import wandScanImage from "./assets/wand-scan.png";
import componentsImage from "./assets/scan-tools/components.png";
import holesImage from "./assets/scan-tools/holes.png";
import boundariesImage from "./assets/scan-tools/boundaries.png";
import brushImage from "./assets/scan-tools/brush.png";
import freehandImage from "./assets/scan-tools/freehand.png";
import lineImage from "./assets/scan-tools/line.png";
import rectangleImage from "./assets/scan-tools/rectangle.png";
import circleImage from "./assets/scan-tools/circle.png";
import throughImage from "./assets/scan-tools/through.png";
import allImage from "./assets/scan-tools/all.png";
import clearImage from "./assets/scan-tools/clear.png";
import invertImage from "./assets/scan-tools/invert.png";
import hideImage from "./assets/scan-tools/hide.png";
import isolateImage from "./assets/scan-tools/isolate.png";
import revealImage from "./assets/scan-tools/reveal.png";
import connectedImage from "./assets/scan-tools/connected.png";

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

const rasterIcons: Partial<Record<ScanIconName, string>> = {
  wand: wandScanImage,
  components: componentsImage,
  holes: holesImage,
  boundaries: boundariesImage,
  brush: brushImage,
  freehand: freehandImage,
  line: lineImage,
  rectangle: rectangleImage,
  circle: circleImage,
  through: throughImage,
  all: allImage,
  clear: clearImage,
  invert: invertImage,
  hide: hideImage,
  isolate: isolateImage,
  reveal: revealImage,
  connected: connectedImage,
  boundary: boundariesImage,
  revealSelected: revealImage,
};

/** Generated CAD images: gold denotes selection, cyan denotes the action. */
export function ScanToolIcon({
  name,
  size,
}: {
  name: ScanIconName;
  size?: number;
}) {
  const rasterImage = rasterIcons[name];
  if (rasterImage) {
    return (
      <img
        className="scan-feature-icon"
        src={rasterImage}
        width={size ?? 56}
        height={size ?? 56}
        alt=""
        aria-hidden="true"
        draggable={false}
        data-scan-icon={name}
        data-scan-raster="true"
      />
    );
  }
  const mesh = (
    <g stroke="#8babbc" fill="#344653">
      <path d="M3 5h18v14H3z" />
      <path d="m3 5 9 7 9-7M3 19l9-7 9 7M12 12V5" />
    </g>
  );
  const selected = <path d="m3 19 9-7 9 7Z" fill="#f5c65d" stroke="#ffe09a" />;
  const eye = (
    <g stroke="#86c8ff" fill="none">
      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" fill="#f5c65d" stroke="#ffe09a" />
    </g>
  );
  let drawing: ReactNode;
  switch (name) {
    case "brush":
    case "freehand":
      drawing = (
        <>
          <path
            d="M4 9c-4 4 0 11 7 11 9 0 11-8 4-11-5-3-8 4-11 0Z"
            fill={name === "brush" ? "#f5c65d" : "none"}
            stroke="#f5c65d"
            strokeDasharray={name === "freehand" ? "2 2" : undefined}
          />
          <path d="m10 12 8-9 3 3-8 9" fill="#7bd7e8" stroke="#d4f8ff" />
          <path d="m10 12-3 5 6-2" fill="#eef7fa" />
        </>
      );
      break;
    case "line":
      drawing = (
        <g stroke="#f5c65d" strokeWidth="2">
          <path d="m4 19 16-14" />
          <circle cx="4" cy="19" r="1.5" fill="#f5c65d" />
          <circle cx="20" cy="5" r="1.5" fill="#f5c65d" />
        </g>
      );
      break;
    case "rectangle":
      drawing = (
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          stroke="#f5c65d"
          strokeWidth="2"
          strokeDasharray="3 2"
        />
      );
      break;
    case "circle":
      drawing = (
        <>
          {mesh}
          <circle
            cx="12"
            cy="12"
            r="7"
            fill="#f5c65d"
            fillOpacity=".6"
            stroke="#8de7fa"
            strokeDasharray="2 2"
          />
        </>
      );
      break;
    case "through":
      drawing = (
        <>
          <path d="M2 5h13v13H2Z" fill="#344653" stroke="#8babbc" />
          <path
            d="M8 9h13v13H8Z"
            fill="#f5c65d"
            fillOpacity=".45"
            stroke="#f5c65d"
            strokeDasharray="2 2"
          />
          <path d="m4 3 16 17m-5 0h5v-5" stroke="#8de7fa" />
        </>
      );
      break;
    case "grow":
    case "shrink":
      drawing = (
        <>
          {mesh}
          {selected}
          <path
            d={
              name === "grow"
                ? "M8 10 3 3m0 5V3h5m8 7 5-7m-5 0h5v5"
                : "m3 3 5 7m-5 0h5V5m13-2-5 7m0-5v5h5"
            }
            stroke="#8de7fa"
            strokeWidth="2"
            fill="none"
          />
        </>
      );
      break;
    case "boundary":
    case "boundaries":
      drawing = (
        <>
          {mesh}
          <path
            d="M3 5h18v14H3Z"
            stroke="#f5c65d"
            strokeWidth="2.5"
            fill="none"
          />
          <g fill="#8de7fa">
            {[
              [3, 5],
              [21, 5],
              [21, 19],
              [3, 19],
            ].map(([cx, cy]) => (
              <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="1.8" />
            ))}
          </g>
        </>
      );
      break;
    case "all":
      drawing = (
        <g fill="#f5c65d" stroke="#ffe09a">
          <path d="M3 5h18v14H3z" />
          <path d="m3 5 9 7 9-7M3 19l9-7 9 7M12 12V5" />
        </g>
      );
      break;
    case "isolate":
      drawing = (
        <>
          {selected}
          <path
            d="M7 3H2v5m15-5h5v5M2 16v5h5m15-5v5h-5"
            fill="none"
            stroke="#8de7fa"
          />
          <path
            d="m6 6 6 6 6-6Z"
            stroke="#8babbc"
            strokeDasharray="2 2"
            fill="none"
          />
        </>
      );
      break;
    case "hide":
    case "reveal":
    case "revealSelected":
      drawing = (
        <>
          {eye}
          {name === "hide" && (
            <path d="m3 3 18 18" stroke="#f48d81" strokeWidth="2.5" />
          )}
          {name === "reveal" && (
            <path d="M18 2v6m-3-3h6" stroke="#9adeb0" strokeWidth="2" />
          )}
          {name === "revealSelected" && (
            <path d="m15 20 3-5 4 5Z" fill="#f5c65d" stroke="#ffe09a" />
          )}
        </>
      );
      break;
    case "invert":
      drawing = (
        <>
          <path d="M5 7h14v10H5Z" fill="#344653" stroke="#8babbc" />
          <path d="M5 7h7v10H5Z" fill="#f5c65d" stroke="#ffe09a" />
          <path
            d="M4 5c4-4 12-4 16 0m-4 0h4V1M20 19c-4 4-12 4-16 0m4 0H4v4"
            stroke="#8de7fa"
          />
        </>
      );
      break;
    case "clear":
      drawing = (
        <g stroke="#8babbc" strokeDasharray="2 2">
          <path d="M3 5h18v14H3Z" />
          <path d="m3 5 9 7 9-7M3 19l9-7 9 7M12 12V5" />
        </g>
      );
      break;
    case "delete":
      drawing = (
        <>
          {mesh}
          {selected}
          <path
            d="m8 7 9 9m0-9-9 9"
            stroke={name === "delete" ? "#ff837b" : "#e8f0f5"}
            strokeWidth="2.7"
          />
        </>
      );
      break;
    case "clip":
      drawing = (
        <>
          <path
            d="m3 7 9-5 9 5v11l-9 4-9-4Z M3 7l9 5 9-5M12 12v10"
            stroke="#f5c65d"
            fill="#344653"
          />
          <path
            d="m2 15 14-7 6 4-14 7Z"
            fill="#7bd7e8"
            fillOpacity=".65"
            stroke="#8de7fa"
          />
        </>
      );
      break;
    case "save":
      drawing = (
        <>
          <path d="M4 3h14l3 3v15H4Z" fill="#344653" stroke="#8de7fa" />
          <path d="M8 3v6h9V3M8 21v-8h9v8" stroke="#8de7fa" fill="none" />
          <path d="m9 19 3-5 4 5Z" fill="#f5c65d" />
        </>
      );
      break;
    case "cut":
    case "copy":
      drawing = (
        <>
          <path d="m3 17 6-10 6 10Z" fill="#f5c65d" stroke="#ffe09a" />
          {name === "copy" ? (
            <path d="m7 4 3-2 6 10" stroke="#8babbc" />
          ) : (
            <path d="M2 12h14" stroke="#8babbc" strokeDasharray="2 2" />
          )}
          <path d="M19 13v8m-4-4h8" stroke="#8de7fa" strokeWidth="2" />
        </>
      );
      break;
    case "smooth":
      drawing = (
        <>
          <path d="m2 8 3-4 3 5 4-6 4 5 3-4 3 4" stroke="#f5c65d" />
          <path d="M2 21c5-8 15-8 20 0M2 21l5-2 5 2 5-2 5 2" stroke="#8de7fa" />
          <path d="M12 10v5m-3-3 3 3 3-3" stroke="#eaf7ff" />
        </>
      );
      break;
    case "defeature":
      drawing = (
        <>
          <path d="M2 9h6V3h8v6h6" stroke="#f5c65d" />
          <path
            d="M8 3h8v6H8Z"
            fill="#f5c65d"
            fillOpacity=".2"
            stroke="#f5c65d"
            strokeDasharray="2 2"
          />
          <path
            d="M2 21h20M12 11v5m-3-3 3 3 3-3"
            stroke="#8de7fa"
            strokeWidth="2"
          />
        </>
      );
      break;
    case "split":
      drawing = (
        <>
          {mesh}
          <path
            d="m11 2-3 20 5-1 3-18Z"
            fill="#7bd7e8"
            fillOpacity=".7"
            stroke="#8de7fa"
          />
          <path d="m3 12 3-2m-3 2 3 2m15-2-3-2m3 2-3 2" stroke="#f5c65d" />
        </>
      );
      break;
    case "components":
      drawing = (
        <>
          <path d="m2 10 5-7 5 7-5 5Z" fill="#f5c65d" stroke="#ffe09a" />
          <path d="m13 17 5-7 5 7-5 5Z" fill="#7bd7e8" stroke="#d4f8ff" />
          <path d="m2 10 5-2 5 2M7 8V3m6 14 5-2 5 2m-5-2v-5" stroke="#344653" />
        </>
      );
      break;
    case "holes":
      drawing = (
        <>
          {mesh}
          <circle
            cx="12"
            cy="12"
            r="5"
            fill="#202326"
            stroke="#f5c65d"
            strokeWidth="2"
          />
          <path d="M12 8v8m-4-4h8" stroke="#8de7fa" />
        </>
      );
      break;
  }
  return (
    <svg
      className="scan-feature-icon"
      width={size ?? 22}
      height={size ?? 22}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-scan-icon={name}
    >
      {drawing}
    </svg>
  );
}
