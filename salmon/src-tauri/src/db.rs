use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::Path;

use crate::types::{Message, Recommendation, Topic};

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS topics (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                engine      TEXT NOT NULL,
                workdir     TEXT NOT NULL,
                model       TEXT,
                session_id  TEXT,
                danger_mode INTEGER NOT NULL DEFAULT 0,
                archived    INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id         TEXT PRIMARY KEY,
                topic_id   TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT NOT NULL,
                tool_calls TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, created_at);
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        // Lightweight migrations for existing DBs.
        let _ = conn.execute(
            "ALTER TABLE topics ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE recommendations ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE recommendations ADD COLUMN self_value TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE recommendations ADD COLUMN peer_value TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE recommendations ADD COLUMN payoff TEXT NOT NULL DEFAULT ''",
            [],
        );
        // v0.7.2: per-turn token + duration columns. NULL is fine for
        // historical rows that predate the schema; aggregations COALESCE
        // them to 0 so old data doesn't poison the totals.
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN token_in INTEGER", []);
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN token_out INTEGER", []);
        let _ = conn.execute("ALTER TABLE messages ADD COLUMN duration_ms INTEGER", []);
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS recommendations (
                id              TEXT PRIMARY KEY,
                source_engine   TEXT NOT NULL,
                topic_id        TEXT,
                title           TEXT NOT NULL,
                rationale       TEXT NOT NULL,
                action_hint     TEXT NOT NULL,
                payoff          TEXT NOT NULL DEFAULT '',
                status          TEXT NOT NULL,
                priority        TEXT NOT NULL DEFAULT 'medium',
                self_value      TEXT,
                peer_value      TEXT,
                generated_at    INTEGER NOT NULL,
                decided_at      INTEGER,
                decision_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_rec_status
                ON recommendations(status, generated_at DESC);
            "#,
        )?;
        Ok(Self { conn })
    }

    pub fn create_topic(
        &mut self,
        title: &str,
        engine: &str,
        workdir: &str,
        model: Option<&str>,
        danger_mode: bool,
    ) -> Result<Topic> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO topics (id,title,engine,workdir,model,session_id,danger_mode,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)",
            params![id, title, engine, workdir, model, Option::<String>::None, danger_mode as i64, now, now],
        )?;
        Ok(Topic {
            id,
            title: title.into(),
            engine: engine.into(),
            workdir: workdir.into(),
            model: model.map(String::from),
            session_id: None,
            danger_mode,
            archived: false,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_topics(&self) -> Result<Vec<Topic>> {
        let mut stmt = self.conn.prepare(
            "SELECT id,title,engine,workdir,model,session_id,danger_mode,archived,created_at,updated_at
             FROM topics ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Topic {
                id: r.get(0)?,
                title: r.get(1)?,
                engine: r.get(2)?,
                workdir: r.get(3)?,
                model: r.get(4)?,
                session_id: r.get(5)?,
                danger_mode: r.get::<_, i64>(6)? != 0,
                archived: r.get::<_, i64>(7)? != 0,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })?;
        let mut out = Vec::new();
        for t in rows {
            out.push(t?);
        }
        Ok(out)
    }

    pub fn get_topic(&self, id: &str) -> Result<Option<Topic>> {
        let mut stmt = self.conn.prepare(
            "SELECT id,title,engine,workdir,model,session_id,danger_mode,archived,created_at,updated_at
             FROM topics WHERE id = ?",
        )?;
        let mut rows = stmt.query_map(params![id], |r| {
            Ok(Topic {
                id: r.get(0)?,
                title: r.get(1)?,
                engine: r.get(2)?,
                workdir: r.get(3)?,
                model: r.get(4)?,
                session_id: r.get(5)?,
                danger_mode: r.get::<_, i64>(6)? != 0,
                archived: r.get::<_, i64>(7)? != 0,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })?;
        if let Some(t) = rows.next() {
            return Ok(Some(t?));
        }
        Ok(None)
    }

    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE topics SET archived=? WHERE id=?",
            params![archived as i64, id],
        )?;
        Ok(())
    }

    pub fn delete_topic(&mut self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM messages WHERE topic_id = ?", params![id])?;
        self.conn
            .execute("DELETE FROM topics WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn rename_topic(&mut self, id: &str, title: &str) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE topics SET title=?, updated_at=? WHERE id=?",
            params![title, now, id],
        )?;
        Ok(())
    }

    pub fn set_session_id(&mut self, id: &str, sid: &str) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE topics SET session_id=?, updated_at=? WHERE id=?",
            params![sid, now, id],
        )?;
        Ok(())
    }

    pub fn set_danger_mode(&mut self, id: &str, danger: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE topics SET danger_mode=? WHERE id=?",
            params![danger as i64, id],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key=?")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(r) = rows.next()? {
            Ok(Some(r.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&mut self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key,value) VALUES(?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn touch_topic(&mut self, id: &str) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        self.conn
            .execute("UPDATE topics SET updated_at=? WHERE id=?", params![now, id])?;
        Ok(())
    }

    pub fn append_message(
        &mut self,
        topic_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&serde_json::Value>,
    ) -> Result<Message> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        let tc_text = tool_calls.map(|v| v.to_string());
        self.conn.execute(
            "INSERT INTO messages (id,topic_id,role,content,tool_calls,created_at) VALUES (?,?,?,?,?,?)",
            params![id, topic_id, role, content, tc_text, now],
        )?;
        self.touch_topic(topic_id)?;
        Ok(Message {
            id,
            topic_id: topic_id.into(),
            role: role.into(),
            content: content.into(),
            tool_calls: tool_calls.cloned(),
            created_at: now,
            token_in: None,
            token_out: None,
            duration_ms: None,
        })
    }

    /// Fold token usage + (optionally) duration into an existing message
    /// row — called when the engine emits a Usage event after the turn
    /// completes. Adds rather than replaces tokens so partial/re-issued
    /// usage events don't truncate the count.
    pub fn add_message_tokens(
        &mut self,
        message_id: &str,
        input_tokens: i64,
        output_tokens: i64,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE messages
             SET token_in  = COALESCE(token_in,  0) + ?,
                 token_out = COALESCE(token_out, 0) + ?
             WHERE id = ?",
            params![input_tokens, output_tokens, message_id],
        )?;
        Ok(())
    }

    /// Stamp how long this assistant turn ran (ms) — set once when
    /// `exited` fires for the message. Idempotent.
    pub fn set_message_duration(&mut self, message_id: &str, duration_ms: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE messages SET duration_ms = ? WHERE id = ?",
            params![duration_ms, message_id],
        )?;
        Ok(())
    }

    /// Fold tokens into whichever assistant message in this topic is
    /// "most recent" (max created_at). Used by the Tauri command that
    /// fires on Usage stream events — engine.rs deliberately doesn't
    /// thread DB ids through the callback chain, so we resolve "the
    /// turn that just ended" here by querying.
    pub fn add_latest_assistant_tokens(
        &mut self,
        topic_id: &str,
        input_tokens: i64,
        output_tokens: i64,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE messages SET
               token_in  = COALESCE(token_in,  0) + ?,
               token_out = COALESCE(token_out, 0) + ?
             WHERE id = (
               SELECT id FROM messages
               WHERE topic_id = ? AND role = 'assistant'
               ORDER BY created_at DESC LIMIT 1
             )",
            params![input_tokens, output_tokens, topic_id],
        )?;
        Ok(())
    }

    /// Same as set_message_duration but resolves by topic+latest. Idempotent
    /// only in the no-overlapping-turns case — fine for our serial-prompt
    /// flow.
    pub fn set_latest_assistant_duration(
        &mut self,
        topic_id: &str,
        duration_ms: i64,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE messages SET duration_ms = ?
             WHERE id = (
               SELECT id FROM messages
               WHERE topic_id = ? AND role = 'assistant'
               ORDER BY created_at DESC LIMIT 1
             )",
            params![duration_ms, topic_id],
        )?;
        Ok(())
    }

    pub fn insert_recommendation(&mut self, r: &Recommendation) -> Result<()> {
        self.conn.execute(
            "INSERT INTO recommendations
             (id,source_engine,topic_id,title,rationale,action_hint,payoff,status,
              priority,self_value,peer_value,
              generated_at,decided_at,decision_reason)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                r.id, r.source_engine, r.topic_id, r.title, r.rationale,
                r.action_hint, r.payoff, r.status,
                r.priority, r.self_value, r.peer_value,
                r.generated_at, r.decided_at, r.decision_reason
            ],
        )?;
        Ok(())
    }

    pub fn list_recommendations(&self, status_filter: Option<&str>, limit: usize) -> Result<Vec<Recommendation>> {
        let (sql, has_filter) = if status_filter.is_some() {
            (
                "SELECT id,source_engine,topic_id,title,rationale,action_hint,payoff,status,
                        priority,self_value,peer_value,
                        generated_at,decided_at,decision_reason
                 FROM recommendations WHERE status=? ORDER BY generated_at DESC LIMIT ?",
                true,
            )
        } else {
            (
                "SELECT id,source_engine,topic_id,title,rationale,action_hint,payoff,status,
                        priority,self_value,peer_value,
                        generated_at,decided_at,decision_reason
                 FROM recommendations ORDER BY generated_at DESC LIMIT ?",
                false,
            )
        };
        let mut stmt = self.conn.prepare(sql)?;
        let map_row = |r: &rusqlite::Row| -> rusqlite::Result<Recommendation> {
            Ok(Recommendation {
                id: r.get(0)?,
                source_engine: r.get(1)?,
                topic_id: r.get(2)?,
                title: r.get(3)?,
                rationale: r.get(4)?,
                action_hint: r.get(5)?,
                payoff: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                status: r.get(7)?,
                priority: r.get::<_, Option<String>>(8)?.unwrap_or_else(|| "medium".to_string()),
                self_value: r.get(9)?,
                peer_value: r.get(10)?,
                generated_at: r.get(11)?,
                decided_at: r.get(12)?,
                decision_reason: r.get(13)?,
            })
        };
        let rows: Vec<Recommendation> = if has_filter {
            let s = status_filter.unwrap();
            stmt.query_map(params![s, limit as i64], map_row)?
                .collect::<rusqlite::Result<_>>()?
        } else {
            stmt.query_map(params![limit as i64], map_row)?
                .collect::<rusqlite::Result<_>>()?
        };
        Ok(rows)
    }

    pub fn update_recommendation_status(&mut self, id: &str, status: &str) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE recommendations SET status=?, decided_at=? WHERE id=?",
            params![status, now, id],
        )?;
        Ok(())
    }

    pub fn update_recommendation_reason(&mut self, id: &str, reason: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE recommendations SET decision_reason=? WHERE id=?",
            params![reason, id],
        )?;
        Ok(())
    }

    pub fn get_recommendation(&self, id: &str) -> Result<Option<Recommendation>> {
        let mut stmt = self.conn.prepare(
            "SELECT id,source_engine,topic_id,title,rationale,action_hint,payoff,status,
                    priority,self_value,peer_value,
                    generated_at,decided_at,decision_reason
             FROM recommendations WHERE id=?",
        )?;
        let mut rows = stmt.query_map(params![id], |r| {
            Ok(Recommendation {
                id: r.get(0)?,
                source_engine: r.get(1)?,
                topic_id: r.get(2)?,
                title: r.get(3)?,
                rationale: r.get(4)?,
                action_hint: r.get(5)?,
                payoff: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                status: r.get(7)?,
                priority: r.get::<_, Option<String>>(8)?.unwrap_or_else(|| "medium".to_string()),
                self_value: r.get(9)?,
                peer_value: r.get(10)?,
                generated_at: r.get(11)?,
                decided_at: r.get(12)?,
                decision_reason: r.get(13)?,
            })
        })?;
        if let Some(r) = rows.next() {
            return Ok(Some(r?));
        }
        Ok(None)
    }

    pub fn expire_pending_recommendations(&mut self, older_than_ms: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE recommendations SET status='expired'
             WHERE status='pending' AND generated_at < ?",
            params![older_than_ms],
        )?;
        Ok(())
    }

    pub fn list_messages(&self, topic_id: &str) -> Result<Vec<Message>> {
        let mut stmt = self.conn.prepare(
            "SELECT id,topic_id,role,content,tool_calls,created_at,
                    token_in,token_out,duration_ms
             FROM messages
             WHERE topic_id=? ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![topic_id], |r| {
            let tc: Option<String> = r.get(4)?;
            let tc = tc.and_then(|s| serde_json::from_str(&s).ok());
            Ok(Message {
                id: r.get(0)?,
                topic_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                tool_calls: tc,
                created_at: r.get(5)?,
                token_in: r.get(6).ok(),
                token_out: r.get(7).ok(),
                duration_ms: r.get(8).ok(),
            })
        })?;
        let mut out = Vec::new();
        for m in rows {
            out.push(m?);
        }
        Ok(out)
    }

    /// Build the homepage / settings usage rollup. One pass over messages
    /// joined with topics, bucketed by (today / week / month / total) using
    /// LOCAL day boundaries so "今日" matches what the user sees on their
    /// clock.
    pub fn usage_summary(&self) -> Result<crate::types::UsageSummary> {
        use crate::types::{EngineUsage, TopicUsage, UsageSummary};
        let now = chrono::Local::now();
        let today_start = now
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .and_then(|d| d.and_local_timezone(chrono::Local).single())
            .map(|d| d.timestamp_millis())
            .unwrap_or(0);
        let week_start = today_start - 6 * 24 * 60 * 60 * 1000;     // last 7 days incl today
        let month_start = today_start - 29 * 24 * 60 * 60 * 1000;   // last 30 days incl today

        let mut summary = UsageSummary::default();

        // Aggregate buckets in a single SELECT over assistant messages —
        // user rows have no token columns and would just contribute zeros.
        let mut stmt = self.conn.prepare(
            "SELECT created_at, COALESCE(token_in,0), COALESCE(token_out,0)
             FROM messages WHERE role='assistant'",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
        })?;
        for row in rows {
            let (ts, ti, to) = row?;
            summary.total_in += ti;
            summary.total_out += to;
            if ts >= month_start {
                summary.month_in += ti;
                summary.month_out += to;
            }
            if ts >= week_start {
                summary.week_in += ti;
                summary.week_out += to;
            }
            if ts >= today_start {
                summary.today_in += ti;
                summary.today_out += to;
            }
        }

        // By-engine: join messages → topics on topic_id and group by engine.
        let mut stmt = self.conn.prepare(
            "SELECT t.engine,
                    COALESCE(SUM(m.token_in), 0),
                    COALESCE(SUM(m.token_out), 0)
             FROM messages m
             JOIN topics t ON t.id = m.topic_id
             WHERE m.role='assistant'
             GROUP BY t.engine
             ORDER BY (COALESCE(SUM(m.token_in),0) + COALESCE(SUM(m.token_out),0)) DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(EngineUsage {
                engine: r.get(0)?,
                total_in: r.get(1)?,
                total_out: r.get(2)?,
            })
        })?;
        for row in rows {
            summary.by_engine.push(row?);
        }

        // By-topic: top 50 topics by total tokens. Settings page pages the
        // rest if it ever gets that long; for now this covers any realistic
        // dataset.
        let mut stmt = self.conn.prepare(
            "SELECT m.topic_id, t.title, t.engine,
                    COALESCE(SUM(m.token_in), 0),
                    COALESCE(SUM(m.token_out), 0)
             FROM messages m
             JOIN topics t ON t.id = m.topic_id
             WHERE m.role='assistant'
             GROUP BY m.topic_id
             HAVING SUM(COALESCE(m.token_in,0) + COALESCE(m.token_out,0)) > 0
             ORDER BY (SUM(COALESCE(m.token_in,0) + COALESCE(m.token_out,0))) DESC
             LIMIT 50",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TopicUsage {
                topic_id: r.get(0)?,
                topic_title: r.get(1)?,
                engine: r.get(2)?,
                total_in: r.get(3)?,
                total_out: r.get(4)?,
            })
        })?;
        for row in rows {
            summary.by_topic.push(row?);
        }

        Ok(summary)
    }
}
