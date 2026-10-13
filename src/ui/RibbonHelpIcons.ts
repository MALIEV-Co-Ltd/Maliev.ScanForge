/** Illustrations for full-size Help and Edit commands; compact controls stay simple.
 * Missing illustrations use the command's existing artwork while assets are added.
 */
const images = import.meta.glob<string>("./assets/ribbon-help/*.png", {
  eager: true,
  import: "default",
});

export const RIBBON_HELP_ICONS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(images).map(([path, image]) => [
      path.slice(path.lastIndexOf("/") + 1, -4),
      image,
    ]),
  );
