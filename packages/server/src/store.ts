import { resolve } from "node:path";
import type {
  AgentThread,
  BrowserEvent,
  ChatMessage,
  FeedbackMoment,
  ReviewArtifact,
  ReviewSession,
} from "@oryntra/core";
import type Database from "better-sqlite3";

export class SessionStore {
  constructor(private readonly db: Database.Database) {}

  saveSession(session: ReviewSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(session.id, JSON.stringify(session));
  }

  getSession(id: string): ReviewSession | null {
    const row = this.db
      .prepare("SELECT data FROM sessions WHERE id = ?")
      .get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ReviewSession) : null;
  }

  getLatestSession(): ReviewSession | null {
    const row = this.db
      .prepare("SELECT data FROM sessions ORDER BY rowid DESC LIMIT 1")
      .get() as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as ReviewSession) : null;
  }

  addBrowserEvent(event: BrowserEvent): void {
    this.db
      .prepare(
        "INSERT INTO browser_events (id, session_id, timestamp, data) VALUES (?, ?, ?, ?)",
      )
      .run(event.id, event.sessionId, event.timestamp, JSON.stringify(event));
  }

  listBrowserEvents(sessionId: string, limit = 200): BrowserEvent[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM browser_events WHERE session_id = ?
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(sessionId, limit) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as BrowserEvent).reverse();
  }

  recentBrowserEvents(
    sessionId: string,
    windowSeconds: number,
    maxCount: number,
  ): BrowserEvent[] {
    const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT data FROM browser_events
         WHERE session_id = ? AND timestamp >= ?
         AND json_extract(data, '$.type') != 'mouse_sample'
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(sessionId, cutoff, maxCount) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as BrowserEvent).reverse();
  }

  saveFeedbackMoment(moment: FeedbackMoment): void {
    this.db
      .prepare(
        `INSERT INTO feedback_moments (id, session_id, timestamp, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           timestamp = excluded.timestamp,
           data = excluded.data`,
      )
      .run(moment.id, moment.sessionId, moment.timestamp, JSON.stringify(moment));
  }

  listFeedbackMoments(sessionId: string): FeedbackMoment[] {
    const rows = this.db
      .prepare(
        "SELECT data FROM feedback_moments WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as FeedbackMoment);
  }

  saveChatMessage(message: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, session_id, timestamp, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           timestamp = excluded.timestamp,
           data = excluded.data`,
      )
      .run(
        message.id,
        message.sessionId,
        message.timestamp,
        JSON.stringify(message),
      );
  }

  listChatMessages(sessionId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        "SELECT data FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ChatMessage);
  }

  saveAgentThread(thread: AgentThread): void {
    this.db
      .prepare(
        `INSERT INTO agent_threads (id, session_id, timestamp, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           timestamp = excluded.timestamp,
           data = excluded.data`,
      )
      .run(
        thread.id,
        thread.sessionId,
        thread.updatedAt,
        JSON.stringify(thread),
      );
  }

  listAgentThreads(sessionId: string): AgentThread[] {
    const rows = this.db
      .prepare(
        "SELECT data FROM agent_threads WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as AgentThread);
  }

  getAgentThread(sessionId: string, threadId: string): AgentThread | null {
    const row = this.db
      .prepare("SELECT data FROM agent_threads WHERE id = ? AND session_id = ?")
      .get(threadId, sessionId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AgentThread) : null;
  }

  saveArtifact(artifact: ReviewArtifact): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (id, session_id, kind, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(
        artifact.id,
        artifact.sessionId,
        artifact.kind,
        JSON.stringify(artifact),
      );
  }

  listArtifacts(sessionId: string): ReviewArtifact[] {
    const rows = this.db
      .prepare("SELECT data FROM artifacts WHERE session_id = ? ORDER BY rowid ASC")
      .all(sessionId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ReviewArtifact);
  }

  listSessionsForWorkspace(workspacePath: string): ReviewSession[] {
    const target = resolve(workspacePath);
    const rows = this.db
      .prepare("SELECT data FROM sessions ORDER BY rowid ASC")
      .all() as Array<{ data: string }>;
    return rows
      .map((r) => JSON.parse(r.data) as ReviewSession)
      .filter((s) => resolve(s.workspacePath) === target);
  }

  listChatMessagesForWorkspace(workspacePath: string): ChatMessage[] {
    const sessions = this.listSessionsForWorkspace(workspacePath);
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT data FROM chat_messages
         WHERE session_id IN (${placeholders})
         ORDER BY timestamp ASC`,
      )
      .all(...ids) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ChatMessage);
  }

  listArtifactsForWorkspace(workspacePath: string): ReviewArtifact[] {
    const sessions = this.listSessionsForWorkspace(workspacePath);
    const ids = sessions.map((s) => s.id);
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT data FROM artifacts
         WHERE session_id IN (${placeholders})
         ORDER BY rowid ASC`,
      )
      .all(...ids) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ReviewArtifact);
  }
}
