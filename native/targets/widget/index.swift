//  Clear Week — 위젯
//
//  **위젯이 실질적인 제품이다.** "한 주가 항상 펼쳐져 있음"이 이 제품의
//  경쟁력이고, 손맛은 계속 쓰게 만드는 장치다 (HANDOFF §11).
//
//  위젯은 앱의 데이터를 계산하지 않는다. 앱이 App Group에 펴 둔 것을
//  그대로 읽는다 — **적은 것을 보면 알 수 있는 일은 시키지 않는다.**
//
//  지키는 것은 앱과 같다:
//   · 그은 항목은 그 자리에 남는다. 흐려지지도 내려가지도 않는다.
//   · 숫자를 내놓지 않는다 (달성률·연속기록 금지).
//   · 단색이다.

import WidgetKit
import SwiftUI

private let appGroup = "group.dev.clearweek"

struct Item: Decodable { let text: String; let struck: Int }
struct Day: Decodable { let label: String; let note: String; let items: [Item] }
struct Week: Decodable { let weekId: String; let days: [Day] }

struct Entry: TimelineEntry {
  let date: Date
  let week: Week?
}

func readWeek() -> Week? {
  guard let defaults = UserDefaults(suiteName: appGroup),
        let raw = defaults.string(forKey: "week"),
        let data = raw.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(Week.self, from: data)
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: Date(), week: readWeek()) }

  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
    completion(Entry(date: Date(), week: readWeek()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    // 앱이 적을 때마다 reloadWidget을 부른다. 그래도 자정에는 스스로 한 번 깬다.
    let next = Calendar.current.startOfDay(for: Date().addingTimeInterval(86400))
    completion(Timeline(entries: [Entry(date: Date(), week: readWeek())], policy: .after(next)))
  }
}

struct Ink: View {
  let text: String
  let struck: Bool
  var body: some View {
    Text(text)
      .font(.system(size: 9))
      .foregroundColor(Color(red: 0.11, green: 0.17, blue: 0.31))
      .lineLimit(1)
      // 취소선은 삭제가 아니라 축적이다 — 그은 것도 그대로 남는다
      .strikethrough(struck, color: Color(red: 0.15, green: 0.21, blue: 0.42))
  }
}

struct ClearWeekView: View {
  var entry: Entry
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(Array((entry.week?.days ?? []).enumerated()), id: \.offset) { _, day in
        HStack(alignment: .top, spacing: 6) {
          Text(day.label)
            .font(.system(size: 8, weight: .semibold))
            .foregroundColor(Color(red: 0.60, green: 0.62, blue: 0.67))
            .frame(width: 22, alignment: .leading)
          VStack(alignment: .leading, spacing: 1) {
            ForEach(Array(day.items.prefix(2).enumerated()), id: \.offset) { _, it in
              Ink(text: it.text, struck: it.struck == 1)
            }
          }
          Spacer(minLength: 0)
        }
      }
    }
    .padding(10)
    .containerBackground(.white, for: .widget)
  }
}

@main
struct ClearWeekWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "ClearWeekWidget", provider: Provider()) { entry in
      ClearWeekView(entry: entry)
    }
    .configurationDisplayName("Clear Week")
    .description("한 주가 펼쳐져 있습니다.")
    .supportedFamilies([.systemMedium, .systemLarge])
  }
}
