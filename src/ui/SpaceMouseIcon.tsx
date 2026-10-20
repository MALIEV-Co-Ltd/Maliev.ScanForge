import { GeneratedIcon, type GeneratedIconProps } from "./GeneratedIcon";
type SpaceMouseIconProps = Omit<GeneratedIconProps, "asset">;
/** Navigation controller artwork; the containing control supplies its name. */
export function SpaceMouseIcon({ size = 22, ...props }: SpaceMouseIconProps) {
  return (
    <GeneratedIcon
      {...props}
      asset="spacemouse"
      size={size}
      data-icon="spacemouse"
    />
  );
}
