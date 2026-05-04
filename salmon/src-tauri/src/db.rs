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
        })
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
            "SELECT id,source_engine,topic_id,title,rationale,action_hint,status,
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
            "SELECT id,topic_id,role,content,tool_calls,created_at FROM messages
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
            })
        })?;
        let mut out = Vec::new();
        for m in rows {
            out.push(m?);
        }
        Ok(out)
    }
}
