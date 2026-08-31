/* Проверка «Школы» целиком: один заход, около десяти секунд.
 *
 *   node shkola/tools/verify.mjs
 *
 * Меряем три вещи, и в таком порядке:
 *   1. Правила урока — ловит ли проверка то, что должна ловить.
 *   2. Демо-уроки — проходят ли они собственные правила.
 *   3. Живой прогон в браузере — кликаем урок до конца и смотрим на консоль.
 *
 * Ничего не правится на глаз: если урок «выглядит нормально», но проверка
 * ругается, права проверка.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const kornevaya = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stranica = 'file://' + path.join(kornevaya, 'index.html');
const HROM = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let provaleno = 0;
const nado = (uslovie, chto) => {
  console.log(`${uslovie ? '  ok  ' : ' МИМО '} ${chto}`);
  if (!uslovie) provaleno++;
};

/* ─── Заведомо кривые уроки: проверка обязана их завернуть ──────────────── */

const scena = (p = {}) => ({ kind:'story', say:'Привет.', caption:'А', art:'🐻', options:[], praise:'', ...p });
const urok  = (sceny) => ({ id:'t', title:'Проба', icon:'📘', scenes:sceny });
const shest = (p) => Array.from({length:6}, () => scena(p));

const krivye = [
  ['без названия',        { ...urok(shest()), title:'' },                         'нет названия'],
  ['без сцен',            urok([]),                                               'нет сцен'],
  ['неизвестный вид',     urok([...shest().slice(1), scena({ kind:'igra' })]),     'неизвестный вид'],
  ['нечего сказать',      urok([...shest().slice(1), scena({ say:'' })]),          'нечего сказать'],
  ['один вариант',        urok([...shest().slice(1), scena({ kind:'quiz',
      options:[{caption:'А',art:'',correct:true}], praise:'!' })]),                'меньше двух'],
  ['два верных',          urok([...shest().slice(1), scena({ kind:'quiz', praise:'!',
      options:[{caption:'А',art:'',correct:true},{caption:'Б',art:'',correct:true}] })]), 'верных ответов 2'],
  ['ни одного верного',   urok([...shest().slice(1), scena({ kind:'quiz', praise:'!',
      options:[{caption:'А',art:'',correct:false},{caption:'Б',art:'',correct:false}] })]), 'верных ответов 0'],
  ['одинаковые варианты', urok([...shest().slice(1), scena({ kind:'quiz', praise:'!',
      options:[{caption:'А',art:'',correct:true},{caption:'А',art:'',correct:false}] })]), 'два одинаковых'],
];

/* Не ошибки, но родителю показать стоит */
const somnitelnye = [
  ['длинная фраза',  urok([...shest().slice(1), scena({ say:'В этом длинном предложении столько слов подряд, что шестилетний слушатель потеряет мысль примерно на середине и заскучает.' })]), 'длинная фраза'],
  ['трудное слово',  urok([...shest().slice(1), scena({ say:'Это достопримечательность.' })]), 'трудное слово'],
  ['длинная надпись',urok([...shest().slice(1), scena({ caption:'Очень длинная надпись на весь экран' })]), 'надпись длиннее'],
  ['рябая картинка', urok([...shest().slice(1), scena({ art:'🍎🍎🍎🍎🍎🍎🍎🍎🍎🍎' })]), 'рябит'],
  ['мало сцен',      urok([scena(), scena()]), 'коротковато'],
];

/* ─── Прогон ────────────────────────────────────────────────────────────── */

const brauzer = await chromium.launch({ executablePath: HROM });
const list = await brauzer.newPage({ viewport:{ width:390, height:844 } });   // телефон

const rugan = [];
list.on('console', (m) => { if (m.type() === 'error') rugan.push(m.text()); });
list.on('pageerror', (e) => rugan.push(String(e)));

await list.goto(stranica);
await list.waitForFunction(() => !!window.SHKOLA);

console.log('\n1. Правила урока');
for (const [imya, u, zhdyom] of krivye){
  const { oshibki } = await list.evaluate((x) => window.SHKOLA.proveritUrok(x), u);
  nado(oshibki.some((o) => o.includes(zhdyom)), `${imya} — «${zhdyom}»${oshibki.length ? '' : ' (проверка промолчала)'}`);
}
for (const [imya, u, zhdyom] of somnitelnye){
  const { oshibki, zamechaniya } = await list.evaluate((x) => window.SHKOLA.proveritUrok(x), u);
  nado(!oshibki.length && zamechaniya.some((z) => z.includes(zhdyom)), `${imya} — замечание, не ошибка`);
}

console.log('\n2. Демо-уроки');
const demo = await list.evaluate(() => window.SHKOLA.DEMO.map((u) => ({ u, p: window.SHKOLA.proveritUrok(u) })));
for (const { u, p } of demo){
  nado(!p.oshibki.length,     `«${u.title}» без ошибок${p.oshibki.length ? ': ' + p.oshibki.join('; ') : ''}`);
  nado(!p.zamechaniya.length, `«${u.title}» без замечаний${p.zamechaniya.length ? ': ' + p.zamechaniya.join('; ') : ''}`);
  nado(u.scenes.some((s) => s.kind === 'quiz'), `«${u.title}» есть о чём спросить`);
}

console.log('\n3. Живой прогон');
const kartochki = list.locator('.karta');
nado(await kartochki.count() >= 2, `на полке ${await kartochki.count()} урока`);

const knopkaDalshe = list.locator('#dalshe');

await kartochki.first().click();
await list.waitForSelector('#urok.vidno');

// Меряем кнопку уже внутри урока: снаружи экран скрыт и размер всегда ноль.
const vysota = (await knopkaDalshe.boundingBox())?.height ?? 0;
const kegl = await list.evaluate(() =>
  parseFloat(getComputedStyle(document.querySelector('#nadpis')).fontSize));

const skolkoScen = await list.evaluate(() => window.SHKOLA.DEMO[0].scenes.length);
let shagov = 0;
while (await list.locator('#urok.vidno').count() && shagov < skolkoScen * 3){
  shagov++;
  const vopros = list.locator('.variant');
  if (await vopros.count()){
    // Верный вариант знает только урок — спрашиваем у него, а не угадываем.
    const scena = await list.evaluate(() => document.querySelector('#govorit').textContent);
    const vernyj = await list.evaluate((g) => {
      const s = window.SHKOLA.DEMO[0].scenes.find((s) => s.say === g);
      return s ? s.options.findIndex((o) => o.correct) : -1;
    }, scena);
    nado(vernyj >= 0, `нашёлся верный ответ на «${scena.slice(0, 30)}…»`);
    await vopros.nth(Math.max(vernyj, 0)).click();
    await list.waitForTimeout(3000);        // голос договорит или сработает страховка
  } else if (await list.locator('#dalshe:visible').count()){
    await knopkaDalshe.click();
    await list.waitForTimeout(120);
  } else break;
}

nado(await list.locator('#konec.vidno').count() === 1, 'дошли до финального экрана');
const itog = await list.locator('#itog').textContent().catch(() => '');
nado(/Звёзд: [1-9]/.test(itog ?? ''), `звёзды посчитаны: «${itog}»`);

console.log('\n4. Пригодность для шестилетки');
nado(vysota >= 56, `кнопка «Дальше» высотой ${Math.round(vysota)}px (нужно от 56)`);
nado(kegl >= 30, `надпись сцены ${Math.round(kegl)}px (нужно от 30)`);
const shirinaOk = await list.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
nado(shirinaOk, 'экран не уезжает вбок на телефоне');
await list.locator('#konec-domoj').click();
await list.locator('#k-roditel').click();
nado(await list.locator('#roditel.vidno').count() === 1, 'экран родителя открывается');

console.log('\n5. Консоль');
nado(rugan.length === 0, rugan.length ? `браузер ругался: ${rugan.slice(0,3).join(' | ')}` : 'браузер молчал');

await brauzer.close();

console.log(provaleno ? `\nПровалено проверок: ${provaleno}\n` : '\nВсё сходится.\n');
process.exit(provaleno ? 1 : 0);
