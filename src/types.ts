// Local types for wangs-code. See ARCHITECTURE decisions in the approved
// plan — this file has no behavior of its own, only shapes shared across
// the other modules.

export interface PendingFeatureBuild {
  featureSlug: string;
  project: string;
  awaitingAnswer: boolean;
}

export interface CliArgs {
  /** Target Wangs Foundation project the chat operates on. Defaults to process.cwd(). */
  project?: string;
}
