export type ReviewMode = "normal" | "explain_this" | "element_picker";

export type SessionStatus =
  | "starting"
  | "active"
  | "reviewing"
  | "handoff"
  | "paused"
  | "closed"
  | "failed";

export type IdeProvider =
  | "cursor"
  | "vscode"
  | "windsurf"
  | "jetbrains"
  | "zed"
  | "antigravity"
  | "other";

export type IdeRegistrationSource = "mcp" | "extension" | "cli" | "probe";

export type IdeRegistration = {
  provider: IdeProvider;
  clientId: string;
  label: string;
  workspacePath?: string;
  connected: boolean;
  lastHeartbeat: string;
  source: IdeRegistrationSource;
};

export type IdeHeartbeatRequest = {
  provider: IdeProvider;
  clientId?: string;
  workspacePath?: string;
  source?: IdeRegistrationSource;
  label?: string;
};

export type CaptureMode = "playwright" | "embedded" | "extension";

export type ReviewSession = {
  id: string;
  workspacePath: string;
  repoName: string;
  branchName: string;
  worktreePath?: string;
  appUrl: string;
  devServerCommand?: string;
  status: SessionStatus;
  errorMessage?: string;
  ide?: IdeProvider;
  /** IDE selected for handoff in this session */
  preferredIde?: IdeProvider;
  reviewMode: ReviewMode;
  captureMode?: CaptureMode;
  createdAt: string;
  updatedAt: string;
  /** Resolved from oryntra.yaml when loading session detail */
  facilitatorProvider?: string;
};

export type ElementRef = {
  selector: string;
  role?: string;
  name?: string;
  text?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  domPath?: string;
};

export type SpatialContext = {
  route: string;
  pageTitle: string;
  mouse: { x: number; y: number };
  elementUnderPointer?: ElementRef;
  lastClickedElement?: ElementRef;
  lockedElement?: ElementRef;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
};

export type FeedbackModality =
  | "typed"
  | "voice"
  | "click_only"
  | "explain_this"
  | "element_picker";

export type FeedbackMoment = {
  id: string;
  sessionId: string;
  timestamp: string;
  modality: FeedbackModality;
  transcript?: string;
  spatial: SpatialContext;
  screenshotId?: string;
  accessibilitySnapshotId?: string;
  clipId?: string;
  recentEventIds: string[];
  linkedArtifactIds?: string[];
  ideStatus?: IdeAgentStatus;
};

export type BrowserEvent =
  | {
      id: string;
      sessionId: string;
      type: "click";
      timestamp: string;
      route: string;
      element?: ElementRef;
      screenshotId?: string;
    }
  | {
      id: string;
      sessionId: string;
      type: "navigation" | "console_error" | "network_error" | "dom_snapshot";
      timestamp: string;
      route?: string;
      message?: string;
      url?: string;
      status?: number;
      payload?: unknown;
    }
  | {
      id: string;
      sessionId: string;
      type: "mouse_sample";
      timestamp: string;
      route: string;
      mouse: { x: number; y: number };
      elementUnderPointer?: ElementRef;
    };

export type BrowserState = {
  route: string;
  title: string;
  mouse: { x: number; y: number };
  elementUnderPointer?: ElementRef;
  lastClickedElement?: ElementRef;
  lockedElement?: ElementRef;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status?: number; message?: string }>;
  accessibilitySnapshotId?: string;
};

export type ArtifactStatus =
  | "draft"
  | "needs-clarification"
  | "approved"
  | "in-progress"
  | "implemented"
  | "verified"
  | "completed"
  | "applied"
  | "rejected";

export type CodeReference = {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
};

export type ChangeRequest = {
  kind: "change_request";
  id: string;
  sessionId: string;
  title: string;
  userIntent: string;
  currentBehavior: string;
  expectedBehavior: string;
  affectedRoutes: string[];
  affectedElements?: ElementRef[];
  affectedComponents?: CodeReference[];
  priority: "low" | "medium" | "high";
  status: ArtifactStatus;
  acceptanceCriteria: string[];
  feedbackMomentIds: string[];
  browserEvidence: BrowserEvent[];
  codeEvidence?: CodeReference[];
};

export type WorkOrderTask = {
  id: string;
  description: string;
  type: "doc" | "architecture" | "code" | "test" | "config";
  targetPath?: string;
  status: "pending" | "in-progress" | "done";
};

export type WorkOrder = {
  kind: "work_order";
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  tasks: WorkOrderTask[];
  acceptanceCriteria: string[];
  feedbackMomentIds: string[];
  status: ArtifactStatus;
};

export type DocUpdate = {
  kind: "doc_update";
  id: string;
  sessionId: string;
  targetPath: string;
  summary: string;
  proposedContent: string;
  feedbackMomentIds: string[];
  status: ArtifactStatus;
};

export type ArchitectureUpdate = {
  kind: "architecture_update";
  id: string;
  sessionId: string;
  section: string;
  rationale: string;
  proposedChanges: string;
  feedbackMomentIds: string[];
  status: ArtifactStatus;
};

export type ReviewArtifact =
  | ChangeRequest
  | WorkOrder
  | DocUpdate
  | ArchitectureUpdate;

export type Interpretation = "correct" | "missing" | "wrong" | "unclear";

export type FacilitatorResponse = {
  interpretation: Interpretation;
  summary: string;
  clarifyingQuestion?: string;
  candidateElements?: ElementRef[];
  suggestedArtifacts?: ReviewArtifact[];
  delegatedToIde?: boolean;
  /** When true, Review Room waits for IDE MCP submit_review_response (no local ack). */
  skipAgentReply?: boolean;
};

export type IdeAgentStatus = "pending" | "processed";

export type SubmitIdeAgentResponseRequest = {
  feedbackMomentId: string;
  summary: string;
  chatMessage?: string;
  artifacts?: ReviewArtifact[];
};

export type AgentThreadStatus = "active" | "archived";

export type AgentThread = {
  id: string;
  sessionId: string;
  title: string;
  status: AgentThreadStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  /** Optional link to a Cursor agent chat for this thread */
  cursorChatId?: string;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: "user" | "agent";
  content: string;
  feedbackMomentId?: string;
  /** Draft change request the user can approve inline in chat */
  artifactId?: string;
  /** Agent conversation thread (Cursor-style multi-chat) */
  agentThreadId?: string;
  timestamp: string;
};

export type ServerMessage =
  | { type: "pong" }
  | { type: "browser_event"; event: BrowserEvent }
  | { type: "browser_state"; state: BrowserState }
  | { type: "feedback_moment"; moment: FeedbackMoment }
  | {
      type: "chat_message";
      message: ChatMessage;
    }
  | { type: "artifact"; artifact: ReviewArtifact }
  | { type: "session_status"; status: SessionStatus; reviewMode?: ReviewMode }
  | {
      type: "implement_status";
      status: "pending" | "implementing" | "completed" | "failed";
      message?: string;
    }
  | {
      type: "agent_thread_changed";
      activeThread: AgentThread;
      threads: AgentThread[];
    };

export type CreateSessionRequest = {
  workspacePath: string;
  appUrl: string;
  devCommand?: string;
  ide?: IdeProvider;
  /** IDE selected for handoff in this session */
  preferredIde?: IdeProvider;
  captureMode?: CaptureMode;
};

export type CreateSessionResponse = {
  sessionId: string;
  reviewRoomUrl: string;
  branch: string;
  status: SessionStatus;
};

export type SubmitFeedbackRequest = {
  transcript: string;
  modality?: FeedbackModality;
  reviewMode?: ReviewMode;
  /** Reuse capture from manual Snap (FEAT-019) */
  screenshotId?: string;
  accessibilitySnapshotId?: string;
};

export type SnapPreviewResponse = {
  screenshotId?: string;
  accessibilitySnapshotId?: string;
  spatial: SpatialContext;
  previewUrl?: string;
};

export type PatchHunk = {
  filePath: string;
  startLine: number;
  endLine: number;
  replacement: string;
};

export type ProposedPatch = {
  id: string;
  sessionId: string;
  artifactId: string;
  title: string;
  hunks: PatchHunk[];
  status: "draft" | "approved" | "applied" | "rejected";
};

export type PatchResult = {
  patchId: string;
  appliedFiles: string[];
  failedFiles?: Array<{ filePath: string; error: string }>;
};

export type SubmitFeedbackResponse = {
  feedbackMoment: FeedbackMoment;
  facilitatorResponse: FacilitatorResponse;
  chatMessages: ChatMessage[];
};

export type CursorAgentApproveMode = "continue" | "new";

export type UpdateArtifactRequest = {
  status: ArtifactStatus;
  cursorAgent?: CursorAgentApproveMode;
};

export type WorktreeStatus = {
  branchName: string;
  worktreePath: string;
  exists: boolean;
  clean: boolean;
  ahead: number;
  behind: number;
};

export type ExecutionPlan = {
  sessionId: string;
  worktreePath: string;
  branchName: string;
  tasks: Array<{
    artifactId: string;
    type: string;
    description: string;
    targetPath?: string;
    status: "pending";
  }>;
};

export type HandoffPackage = {
  sessionId: string;
  session: ReviewSession;
  summary: string;
  openItems: string[];
  feedbackMoments: FeedbackMoment[];
  artifacts: ReviewArtifact[];
  transcript: ChatMessage[];
  worktree?: WorktreeStatus;
  executionPlan?: ExecutionPlan;
  targetIde?: IdeProvider;
  targetIdeLabel?: string;
  targetIdeConnected?: boolean;
  generatedAt: string;
};
