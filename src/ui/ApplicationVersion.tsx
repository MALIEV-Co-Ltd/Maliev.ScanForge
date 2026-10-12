import { version } from "../../package.json";
import { Github } from "lucide-react";

export function ApplicationVersion() {
  return (
    <a
      className="application-version"
      href="https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/commits/main/"
      target="_blank"
      rel="noopener noreferrer"
      title="View changelog on GitHub"
      aria-label={`Version ${version}, view changelog on GitHub`}
    >
      <span className="application-version-badge">v{version}</span>
      <Github size={14} aria-hidden="true" />
    </a>
  );
}
