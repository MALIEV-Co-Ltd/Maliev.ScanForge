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
      <Github size={14} aria-hidden="true" />
      <span>v{version}</span>
    </a>
  );
}
