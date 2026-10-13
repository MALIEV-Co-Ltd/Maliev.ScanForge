import newDocumentImage from "./assets/ribbon-tools/newDocument.png";
import openImage from "./assets/ribbon-tools/open.png";
import saveImage from "./assets/ribbon-tools/save.png";
import backupImage from "./assets/ribbon-tools/backup.png";
import editScanImage from "./assets/ribbon-tools/editScan.png";
import repairMeshImage from "./assets/ribbon-tools/repairMesh.png";
import reducePolygonsImage from "./assets/ribbon-tools/reducePolygons.png";
import alignImage from "./assets/ribbon-tools/align.png";
import fitPlaneImage from "./assets/ribbon-tools/fitPlane.png";
import referenceAxisImage from "./assets/ribbon-tools/referenceAxis.png";
import referencePointImage from "./assets/ribbon-tools/referencePoint.png";
import coordinateSystemImage from "./assets/ribbon-tools/coordinateSystem.png";
import sketch2dImage from "./assets/ribbon-tools/sketch2d.png";
import sketchFromSectionImage from "./assets/ribbon-tools/sketchFromSection.png";
import measureImage from "./assets/ribbon-tools/measure.png";
import sectionViewImage from "./assets/ribbon-tools/sectionView.png";
import deviationImage from "./assets/ribbon-tools/deviation.png";
import exportStepImage from "./assets/ribbon-tools/exportStep.png";
import clearImage from "./assets/scan-tools/clear.png";
import revealImage from "./assets/scan-tools/reveal.png";
import { RIBBON_EXTENDED_ICONS } from "./RibbonExtendedIcons";

/** Generated illustrations are reserved for the larger semantic commands. */
export const RIBBON_RASTER_ICONS: Readonly<Record<string, string>> = {
  ...RIBBON_EXTENDED_ICONS,
  deselectAll: clearImage,
  showHidden: revealImage,
  newDocument: newDocumentImage,
  open: openImage,
  save: saveImage,
  backup: backupImage,
  editScan: editScanImage,
  repairMesh: repairMeshImage,
  reducePolygons: reducePolygonsImage,
  align: alignImage,
  fitPlane: fitPlaneImage,
  referenceAxis: referenceAxisImage,
  referencePoint: referencePointImage,
  coordinateSystem: coordinateSystemImage,
  sketch2d: sketch2dImage,
  sketchFromSection: sketchFromSectionImage,
  measure: measureImage,
  sectionView: sectionViewImage,
  deviation: deviationImage,
  exportStep: exportStepImage,
};
