#[cfg(test)]
use chrono::TimeZone;

pub const RELATIVE_DATE_POLICY: &str = "相对日期（今天/今日/明天/明日/明早/后天等）如果出现在某封邮件正文或主题里，必须以该邮件日期作为基准，不得以当前时间作为基准；例如邮件日期是 2026-05-14，正文说“明天/明早”就是 2026-05-15。解析出的时间早于当前时间时，视为已过期；除非邮件明确说明仍需补办，否则不要产出新的待办、日历建议或 briefing 卡。";

const RELATIVE_TERMS: [(&str, i64); 7] = [
    ("今天", 0),
    ("今日", 0),
    ("明天", 1),
    ("明日", 1),
    ("明早", 1),
    ("后天", 2),
    ("後天", 2),
];

pub fn format_local_date(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|| "?".into())
}

pub fn format_local_datetime(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|t| {
            t.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M %Z")
                .to_string()
        })
        .unwrap_or_else(|| "?".into())
}

pub fn relative_date_hint(anchor_ms: i64, text: &str) -> Option<String> {
    let mut mappings = Vec::new();
    for (term, offset_days) in RELATIVE_TERMS {
        if text.contains(term) {
            mappings.push(format!(
                "{}={}",
                term,
                format_local_date_offset(anchor_ms, offset_days)
            ));
        }
    }
    if mappings.is_empty() {
        return None;
    }

    Some(format!(
        "这封邮件日期={}；{}（按邮件日期解析，不按当前日期解析）。",
        format_local_date(anchor_ms),
        mappings.join("，")
    ))
}

fn format_local_date_offset(anchor_ms: i64, offset_days: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(anchor_ms)
        .map(|t| {
            let local = t.with_timezone(&chrono::Local) + chrono::Duration::days(offset_days);
            local.format("%Y-%m-%d").to_string()
        })
        .unwrap_or_else(|| "?".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_dates_anchor_to_message_date() {
        let anchor = chrono::Local
            .with_ymd_and_hms(2026, 5, 14, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let hint = relative_date_hint(anchor, "明早 8:43 出发，今天可取票").unwrap();
        assert!(hint.contains("这封邮件日期=2026-05-14"));
        assert!(hint.contains("明早=2026-05-15"));
        assert!(hint.contains("今天=2026-05-14"));
    }

    #[test]
    fn no_hint_without_relative_terms() {
        let anchor = chrono::Local
            .with_ymd_and_hms(2026, 5, 14, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        assert!(relative_date_hint(anchor, "5月15日 8:43 出发").is_none());
    }
}
