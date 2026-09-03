let pass = 0, fail = 0;

export const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  OK  ' : '  실패'} ${name}` +
    (ok ? '' : `\n         받음: ${JSON.stringify(got)}\n         기대: ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};

export const ok = (name, cond) => check(name, !!cond, true);

export function done(title) {
  console.log(`${title} — 통과 ${pass}, 실패 ${fail}`);
  if (fail) process.exit(1);
}
