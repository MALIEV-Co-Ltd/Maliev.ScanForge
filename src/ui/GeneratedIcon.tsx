import type { ComponentProps } from "react";
import requests from "../../public/icons/generated/requests.json";
import "./generated-icons.css";

const assets = new Set(requests.map(({ id }) => id));
export type GeneratedIconProps = Omit<ComponentProps<"img">, "src" | "alt"> & {
  asset: string;
  size?: number | string;
};

/** Decorative artwork; the containing control supplies the accessible name. */
export function GeneratedIcon({
  asset,
  size = 22,
  className = "",
  ...props
}: GeneratedIconProps) {
  if (!assets.has(asset)) throw new Error(`Missing generated icon: ${asset}`);
  return (
    <img
      {...props}
      src={`${import.meta.env.BASE_URL}icons/generated/${asset}.png`}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={props.width ?? size}
      height={props.height ?? size}
      className={`generated-icon ${className}`.trim()}
      data-icon-style="generated-technical"
    />
  );
}
