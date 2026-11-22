/**
 * Календари: у каждой системы своя структура года, своя неделя и свои праздники.
 * Общего шаблона «пн–вс» нет, григорианского носителя дат тоже нет: дата это год и номер дня в году
 * внутри самой системы, а неделя считается так, как устроена эта система.
 *
 * Режимы недели (week.mode):
 *   'continuous' — неделя идёт сплошным кругом через месяцы и годы (Экзандрия, Голарион);
 *                  день недели первого дня опорного года задаёт weekAnchor (его выбирает игрок);
 *   'fixed'      — каждый период (месяц, праздничная неделя) кратен неделе, поэтому каждый месяц
 *                  начинается с одного и того же дня недели (Эберрон, Грейхок);
 *   'tenday'     — десятидневки внутри месяца, праздничные дни стоят вне декад (Харптос).
 *
 * Праздники лежат слоями (calendar.layers): каждый слой включается и выключается отдельно.
 * Запись праздника: { d, to?, ru, en, layer, note?, moon?, weak? }
 *   d, to — день или промежуток дней внутри периода; moon: true — без даты, «по луне»;
 *   weak: true — дата из единственного источника, помечается в окне.
 *
 * Русские названия: мои транслитерации и переводы, правятся в этом файле в одном месте.
 * Источники и расхождения: docs/КАЛЕНДАРИ.md.
 */
(function (root) {
  const m = (id, ru, en, days, extra = {}) => ({ type: 'month', id, ru, en, days, ...extra });
  const f = (id, ru, en, days, extra = {}) => ({ type: 'festival', id, ru, en, days, ...extra });
  const h = (d, ru, en, layer = 'general', extra = {}) => ({ d, ru, en, layer, ...extra });
  const hr = (d, to, ru, en, layer, extra = {}) => ({ d, to, ru, en, layer, ...extra });
  const moon = (ru, en, layer, note, phase = '') => ({ moon: true, ru, en, layer, note, phase });   // phase: full | new | young (день после новолуния); пусто: без привязки к дню
  const mod = (a, b) => ((a % b) + b) % b;

  // ---------- Харптос (Фаэрун) ----------
  const HARPTOS_MONTHS = [
    ['hammer', 'Хаммер', 'Hammer', 'Разгар зимы'], ['alturiak', 'Альтуриак', 'Alturiak', 'Коготь зимы'],
    ['ches', 'Чес', 'Ches', 'Коготь закатов'], ['tarsakh', 'Тарсак', 'Tarsakh', 'Коготь штормов'],
    ['mirtul', 'Миртул', 'Mirtul', 'Таяние'], ['kythorn', 'Киторн', 'Kythorn', 'Время цветов'],
    ['flamerule', 'Флеймрул', 'Flamerule', 'Разгар лета'], ['eleasis', 'Элесиас', 'Eleasis', 'Солнце в зените'],
    ['eleint', 'Элейнт', 'Eleint', 'Угасание'], ['marpenoth', 'Марпенот', 'Marpenoth', 'Листопад'],
    ['uktar', 'Уктар', 'Uktar', 'Умирание'], ['nightal', 'Найтол', 'Nightal', 'Завершение года'],
  ];
  const HARPTOS_FESTIVALS = {
    hammer: [f('midwinter', 'Середина зимы', 'Midwinter', 1, { note: 'пиры, гадания и разговоры о том, что принесёт год' })],
    tarsakh: [f('greengrass', 'Зеленотравье', 'Greengrass', 1, { note: 'первый день весны: цветы, подарки и благодарность земле' })],
    flamerule: [f('midsummer', 'Середина лета', 'Midsummer', 1, { note: 'музыка, гулянья, влюблённые и свадьбы' }), { leap: true, ...f('shieldmeet', 'Щитовой сход', 'Shieldmeet', 1, { note: 'раз в четыре года: турниры, суды, переговоры и пересмотр договоров' }) }],
    eleint: [f('highharvestide', 'Праздник урожая', 'Highharvestide', 1, { note: 'конец жатвы: ярмарки, торговля, последние рейсы до штормов' })],
    uktar: [f('feastofthemoon', 'Пир Луны', 'Feast of the Moon', 1, { note: 'вечер памяти предков и умерших, рассказы о былом' })],
  };

  const HARPTOS_LAYERS = [
    { id: 'waterdeep', ru: 'Глубоководье', color: '#4aa3c8', on: true, note: 'городские праздники', src: 'пересказы на fan-вики, даты сверены по 2–3 источникам; Зимний щит и Райестертид только из одного' },
    { id: 'drow', ru: 'Дроу', color: '#b94a8a', on: true, note: 'Киарансали, Вхаэраун, Ллос', src: 'Kismet’s D&D (сводка по книгам); датированных праздников у дроу очень мало' },
    { id: 'elves', ru: 'Эльфы', color: '#5fb36f', on: true, note: 'Demihuman Deities, Complete Book of Elves', src: 'Dragon’s Neck Wiki со ссылками на страницы книг' },
    { id: 'waukeen', ru: 'Церковь Вокин', color: '#d9a441', on: false, note: 'праздники торговцев, по одному в месяц', src: 'Kismet’s D&D' },
    { id: 'gods', ru: 'Другие боги', color: '#9a7ad0', on: false, note: 'Морадин, Торм, Гонд, Шаундакул, Хоар, Джергал, Баал', src: 'Kismet’s D&D; Баал: Forgotten Realms Wiki, «Church of Bhaal» и «Feast of the Moon»' },
  ];

  // Праздники по месяцам. К месяцу относится запись, у которой есть d; к праздничному дню — запись в HARPTOS_FEST_HOL.
  const HARPTOS_HOL = {
    hammer: [
      h(1, 'Зимний щит', 'Wintershield', 'waterdeep', { weak: true }),
      h(30, 'Память о бойне (Шеваракш)', 'Memory of the Slaughter', 'elves', { note: 'Хаммер 30/31 — Альтуриак 1, Demihuman Deities' }),
      h(30, 'Погребальный подъём (Киарансали)', 'The Graverending', 'drow', { note: 'в канун Середины зимы жрецы поднимают нежить, она мстит убийцам 24 часа или до исполнения мести' }),
      h(1, 'День Громового благословения (Морадин)', 'Thunder Blessing Day', 'gods', { note: 'гномьи и дварфские общины благодарят Морадина' }),
      h(15, 'Утешение счёта (Вокин)', 'Cold Counting Comfort', 'waukeen', { note: 'жрецы Вокин празднуют учёт' }),
    ],
    alturiak: [
      h(14, 'Великое веселье', 'Grand Revel', 'waterdeep'),
      h(20, 'Великое ткачество (Вокин)', 'Great Weave', 'waukeen', { note: 'жрецы Вокин празднуют ткани' }),
    ],
    ches: [
      h(1, 'Райестертид', 'Rhyestertide', 'waterdeep', { weak: true }),
      h(19, 'День фей', 'Fey Day', 'waterdeep', { note: 'грань между Материальным миром и Страной фей истончается' }),
      h(19, 'Расцвет (Риллифан Раллатил)', 'The Budding', 'elves'),
      hr(19, 26, 'Весенний обряд (романтика)', 'Springrite', 'elves', { note: 'Complete Book of Elves' }),
      h(19, 'Танец кружащихся ветров (Эйрди Файна)', 'The Dance of the Swirling Winds', 'elves', { note: 'и в Элейнте 21' }),
      h(30, 'Высокая монета (Вокин)', 'High Coin', 'waukeen', { note: 'жрецы Вокин празднуют богатство' }),
    ],
    tarsakh: [
      hr(1, 10, 'Вокинтид', 'Waukeentide', 'waterdeep', { note: 'десять дней в честь Вокин, несколько праздников в одном' }),
      h(10, 'Сферы (Вокин)', 'Spheres', 'waukeen', { note: 'жрецы Вокин празднуют щедрость' }),
      h(15, 'Верховой ветер (Шаундакул)', 'Windride', 'gods', { note: 'жрецы без ветрохода принимают газообразную форму, к вечеру их опускает на новом месте' }),
    ],
    mirtul: [
      hr(1, 12, 'Иппеншир (Гонд)', 'Ippensheir', 'gods', { note: 'двенадцать дней после Зеленотравья: последователи Гонда собираются там, где работал великий мастер' }),
      h(12, 'Саммардах (Вокин)', 'Sammardach', 'waukeen', { note: 'жрецы Вокин празднуют благодетелей' }),
    ],
    kythorn: [
      h(20, 'Век (Коррелон Ларетиан)', 'Agelong', 'elves'),
      h(21, 'Блеск пряжек (Вокин)', 'Brightbuckle', 'waukeen', { note: 'жрецы Вокин празднуют наряды' }),
    ],
    flamerule: [hr(3, 5, 'Сорнин (Вокин)', 'Sornyn', 'waukeen', { note: 'жрецы Вокин празднуют заключение сделок' })],
    eleasis: [
      h(1, 'День Агайрона', 'Ahghairon’s Day', 'waterdeep', { note: 'в честь первого Лорда города' }),
      h(13, 'Божественная смерть (Торм)', 'Divine Death', 'gods', { note: 'церковь Торма вспоминает гибель Бэйна' }),
      h(17, 'Хулдарк (Вокин)', 'Huldark', 'waukeen', { note: 'жрецы Вокин празднуют изобилие' }),
    ],
    eleint: [
      h(7, 'Спринндальстар (Вокин)', 'Spryndalstar', 'waukeen', { note: 'жрецы Вокин празднуют магию' }),
      h(21, 'Танец кружащихся ветров (Эйрди Файна)', 'The Dance of the Swirling Winds', 'elves'),
      h(21, 'Осенний обряд (смертность)', 'Fallrite', 'elves', { note: 'Complete Book of Elves' }),
      h(21, 'Превращение (Риллифан Раллатил)', 'The Transformation', 'elves'),
    ],
    marpenoth: [
      h(1, 'Мартун (Вокин)', 'Marthoon', 'waukeen', { note: 'жрецы Вокин празднуют стражу' }),
      h(11, 'Грядущая беда (Хоар)', 'The Impending Doom', 'gods', { note: 'один из двух главных дней Хоара: барабаны и очищение весь день' }),
      h(15, 'Истинное воскресение (Торм)', 'True Resurrection', 'gods', { note: 'радостный праздник возвращения Торма' }),
    ],
    uktar: [],
    nightal: [
      h(1, 'Таинства Светозарного облака (Сехания Лунная Дуга)', 'Mystic Rites of the Luminous Cloud', 'elves'),
      h(20, 'Год-прилив', 'Yeartide', 'elves', { note: 'Complete Book of Elves' }),
      h(25, 'Орбар (Вокин)', 'Orbar', 'waukeen', { note: 'жрецы Вокин напоминают об опасности излишеств' }),
      h(30, 'Ночь другого года (Джергал)', 'Night of Another Year', 'gods', { note: 'последняя ночь года: жрецы Джергала зачитывают имена умерших' }),
    ],
  };
  // праздничные дни: запись с d = 1 (единственный день), привязана к id праздника
  const HARPTOS_FEST_HOL = {
    midwinter: [h(1, 'Объятие Масочного Лорда (Вхаэраун)', 'Masked Lord’s Embrace', 'drow', { note: 'в ночь Середины зимы последователи Вхаэрауна лишают себя чувств на день размышлений' })],
    feastofthemoon: [h(1, 'Пир Луны (Баал)', 'Feast of the Moon', 'gods', { note: 'единственный обряд церкви Баала с твёрдой датой: жрецы пируют, пересказывают самые необычные убийства и поминают павших на службе Владыке Убийств' })],
    shieldmeet: [h(1, 'Киннелос-Кор (Праздник мира Коррелона)', 'Cinnaelos’Cor', 'elves', { note: 'эльфийское название Щитового схода' })],
  };
  const HARPTOS_MOON = [
    moon('Жертвы Ллос: поверхностные эльфы', 'Lolth’s moon sacrifices', 'drow', 'каждое полнолуние', 'full'),
    moon('Охота и жертвы Вхаэрауна', 'Vhaeraun’s hunts', 'drow', 'каждое новолуние, последователи на поверхности', 'new'),
    moon('Полуночная игра (Эревен Иллесер)', 'Midnight Gambol', 'elves', 'каждое полнолуние', 'full'),
    moon('Тайны сердца (Ханали Селанил)', 'Secrets of the Heart', 'elves', 'каждое полнолуние', 'full'),
    moon('Лунное освящение (Сехания)', 'Lunar Hallowing', 'elves', 'каждое полнолуние', 'full'),
    moon('Жертва охотника (Соноро Теландира)', 'Hunter’s Sacrifice', 'elves', 'каждое полнолуние', 'full'),
    moon('Лате’кор, лесное таинство растущей луны (Коррелон)', 'Lateu’quor', 'elves', 'каждая молодая луна', 'young'),
  ];
  const harptosSeason = (p, day) => {
    if (p.type === 'festival') return p.season;
    const pos = p.n * 100 + day;
    if (pos >= 1220 || pos < 319) return 'зима';
    if (pos < 620) return 'весна';
    if (pos < 921) return 'лето';
    return 'осень';
  };
  const harptos = {
    id: 'harptos', ru: 'Фаэрун', en: 'Calendar of Harptos', world: 'Фаэрун, Забытые королевства',
    era: { abbr: 'DR', ru: 'ЛД', full: 'Летоисчисление Долин' }, defaultYear: 1492,
    week: { mode: 'tenday', len: 10, names: null, label: 'декада' },
    accent: '#c8a24a',
    layers: HARPTOS_LAYERS,
    moonHolidays: HARPTOS_MOON,
    periods(year) {
      const out = [];
      HARPTOS_MONTHS.forEach(([id, ru, en, epithet], i) => {
        out.push(m(id, ru, en, 30, { n: i + 1, epithet, seasonFn: harptosSeason, holidays: HARPTOS_HOL[id] ?? [] }));
        for (const fe of HARPTOS_FESTIVALS[id] ?? []) {
          if (fe.leap && mod(year, 4) !== 0) continue;
          const { leap, ...rest } = fe;
          const season = id === 'hammer' ? 'зима' : id === 'tarsakh' ? 'весна' : id === 'flamerule' ? 'лето' : 'осень';
          out.push({ ...rest, season, after: id, holidays: HARPTOS_FEST_HOL[rest.id] ?? [] });
        }
      });
      return out;
    },
    notes: ['12 месяцев по 30 дней: по три декады. Праздники стоят между месяцами и не входят ни в декады, ни в месяцы.',
      'Щитовой сход добавляется после Середины лета в годы, кратные 4.',
      'Праздники по слоям: у каждого слоя свой цвет точки. У дроу датированных праздников почти нет, остальное «по луне» (список в панели).'],
  };

  // ---------- Экзандрия (Critical Role, Wildemount) ----------
  const EXANDRIA = [
    ['horisal', 'Хорисал', 'Horisal', 29, [h(1, 'Новый рассвет', 'New Dawn'), h(27, 'Золото холмов', 'Hillsgold')]],
    ['misuthar', 'Мисутар', 'Misuthar', 30, [h(7, 'День испытаний', 'Day of Challenging')]],
    ['dualahei', 'Дуалахей', 'Dualahei', 30, [h(13, 'Праздник обновления', 'Renewal Festival'), h(20, 'Величие дикой природы', "Wild's Grandeur")]],
    ['thunsheer', 'Тунширр', 'Thunsheer', 31, [h(11, 'Начало жатвы', "Harvest's Rise"), h(31, 'День Мерифронд', "Merryfrond's Day")]],
    ['unndilar', 'Ундилар', 'Unndilar', 28, [h(8, 'Глубокое утешение', 'Deep Solace'), h(26, 'Зенит', 'Zenith')]],
    ['brussendar', 'Бруссендар', 'Brussendar', 31, [h(15, 'Ярмарка мастеров', "Artisan's Faire"), h(20, 'Эльфийский рассвет', 'Elvendawn')]],
    ['sydenstar', 'Сайденстар', 'Sydenstar', 32, [h(7, 'Макушка лета', 'Highsummer'), h(14, 'Утро щедрости', 'Morn of Largesse')]],
    ['fessuran', 'Фессуран', 'Fessuran', 29, [h(3, 'Конец жатвы', "Harvest's Close")]],
    ['quenpillar', 'Квенпиллар', "Quen'pillar", 27, [h(10, 'Праздник орешника', 'Hazel Festival'), h(22, 'Рассвет цивилизации', "Civilization's Dawn")]],
    ['cuersaar', 'Куэрсаар', 'Cuersaar', 29, [h(13, 'Ночь вознесения', 'Night of Ascension')]],
    ['duscar', 'Даскар', 'Duscar', 32, [h(2, 'Пустой канун', 'Barren Eve'), h(5, 'Время углей', 'Embertide')]],
  ];
  const exandria = {
    id: 'exandria', ru: 'Экзандрия', en: 'Exandrian Calendar', world: 'Экзандрия, Critical Role',
    era: { abbr: 'PD', ru: 'ПР', full: 'после Расхождения (Post-Divergence)' }, defaultYear: 835,
    week: {
      mode: 'continuous', len: 7, label: 'неделя',
      names: [['Мирезен', 'Miresen'], ['Гриссен', 'Grissen'], ['Уэлсен', 'Whelsen'], ['Контсен', 'Conthsen'], ['Фолсен', 'Folsen'], ['Юлисен', 'Yulisen'], ['Далейсен', "Da'leysen"]].map(([ru, en]) => ({ ru, en })),
    },
    weekAnchor: { year: 835, weekday: 0 },
    accent: '#5fa8b8',
    layers: [{ id: 'general', ru: 'Праздники Экзандрии', color: '#5fa8b8', on: true, note: 'из книги по Wildemount', src: 'расшифровка Wildemount на gmbinder' }],
    periods: () => EXANDRIA.map(([id, ru, en, days, holidays], i) => m(id, ru, en, days, { n: i + 1, holidays })),
    notes: ['11 месяцев разной длины (27–32 дня), 328 дней в году. Неделя в 7 дней не делит ни месяц, ни год: она идёт сплошным кругом, поэтому каждый месяц начинается с другого дня.',
      'Сезонов в источнике нет: у каждого региона они свои.'],
  };

  // ---------- Голарион (Pathfinder, Absalom Reckoning) ----------
  const GOLARION = [
    ['abadius', 'Абадиус', 'Abadius', 31, 'зима', [h(1, 'День основания (Абсалом)', 'Foundation Day', 'civil'), h(6, 'День хранилища (Абадар)', 'Vault Day', 'church')]],
    ['calistril', 'Калистрил', 'Calistril', 28, 'зима', [h(1, 'Ритуал удара плетью (Каллистрия)', 'Ritual of the Whip Sting', 'church'), h(2, 'Мерримид (Друма, Кейден Кайлин)', 'Merrymead', 'church'), h(14, 'Пир силы (Каллистрия)', 'Feast of Vigor', 'church')]],
    ['pharast', 'Фараст', 'Pharast', 31, 'весна', [h(5, 'День костей (Фарасма)', 'Day of Bones', 'church'), h(20, 'Скорбнопад (Арация, Иомедэ)', 'Mourningfell', 'church')]],
    ['gozran', 'Гозран', 'Gozran', 30, 'весна', [h(7, 'Канун течений (Гозрэ)', 'Currentseve', 'church'), h(15, 'Налогофест (Абадар)', 'Taxfest', 'church')]],
    ['desnus', 'Деснус', 'Desnus', 31, 'весна', [h(2, 'Ночь вознесения (Норгорбер)', 'Ascendance Night', 'church'), h(13, 'День Старого мага (Мванги)', 'Old-Mage Day', 'civil')]],
    ['sarenith', 'Сарэнит', 'Sarenith', 30, 'лето', [h(10, 'Пылающие клинки (Сарэнрэ)', 'Burning Blades', 'church')]],
    ['erastus', 'Эрастус', 'Erastus', 31, 'лето', [h(3, 'День лучника (Эрастил)', "Archer's Day", 'church')]],
    ['arodus', 'Ародус', 'Arodus', 31, 'лето', [h(1, 'Вознесение Наследницы (Иомедэ)', "Inheritor's Ascendance", 'church'), h(16, 'Армасс (Аден, Иомедэ, Милани)', 'Armasse', 'church')]],
    ['rova', 'Рова', 'Rova', 30, 'осень', []],
    ['lamashan', 'Ламашан', 'Lamashan', 31, 'осень', []],
    ['neth', 'Нэт', 'Neth', 30, 'осень', []],
    ['kuthona', 'Кутона', 'Kuthona', 31, 'зима', []],
  ];
  const golarion = {
    id: 'golarion', ru: 'Голарион', en: 'Absalom Reckoning', world: 'Голарион, Pathfinder',
    era: { abbr: 'AR', ru: 'АЛ', full: 'Абсаломское летоисчисление' }, defaultYear: 4725,
    week: {
      mode: 'continuous', len: 7, label: 'неделя',
      names: [['День Луны', 'Moonday'], ['День труда', 'Toilday'], ['День достатка', 'Wealday'], ['День клятв', 'Oathday'], ['День огня', 'Fireday'], ['День звезды', 'Starday'], ['День солнца', 'Sunday']].map(([ru, en]) => ({ ru, en })),
    },
    weekAnchor: { year: 4725, weekday: 0 },
    accent: '#b5654a',
    layers: [
      { id: 'general', ru: 'Календарные', color: '#d9a441', on: true, note: 'високосный день', src: 'PathfinderWiki' },
      { id: 'church', ru: 'Церкви и боги', color: '#b5654a', on: true, note: 'дни богов', src: 'PathfinderWiki, Holidays and festivals (выборка)' },
      { id: 'civil', ru: 'Городские и народные', color: '#6ea6c9', on: true, note: 'светские праздники', src: 'PathfinderWiki' },
    ],
    periods(year) {
      return GOLARION.map(([id, ru, en, days, season, holidays], i) => {
        const leap = id === 'calistril' && mod(year, 4) === 0;
        return m(id, ru, en, leap ? 29 : days, {
          n: i + 1, season,
          holidays: leap ? [...holidays, h(29, 'Високосный день', 'Leap Day', 'general')] : holidays,
        });
      });
    },
    notes: ['12 месяцев по 28–31 дню, 365 дней. Раз в четыре года к концу Калистрила добавляется 29-й день (последний високосный год 4724, следующий 4728).',
      'Отсчёт лет идёт с 1 Абадиуса 1 года: день, когда Аден поднял Звёздный камень. Праздников показана выборка: у региона и у храмов их десятки.'],
  };

  // ---------- Эберрон (Галифарский календарь) ----------
  const EBERRON = [
    ['zarantyr', 'Зарантир', 'Zarantyr', 'Середина зимы', 'Шторм', 'Storm'], ['olarune', 'Оларун', 'Olarune', 'Конец зимы', 'Страж', 'Sentinel'],
    ['therendor', 'Терендор', 'Therendor', 'Начало весны', 'Исцеление', 'Healing'], ['eyre', 'Эйр', 'Eyre', 'Середина весны', 'Созидание', 'Making'],
    ['dravago', 'Драваго', 'Dravago', 'Конец весны', 'Укрощение', 'Handling'], ['nymm', 'Нимм', 'Nymm', 'Начало лета', 'Гостеприимство', 'Hospitality'],
    ['lharvion', 'Лхарвион', 'Lharvion', 'Середина лета', 'Обнаружение', 'Detection'], ['barrakas', 'Барракас', 'Barrakas', 'Конец лета', 'Поиск', 'Finding'],
    ['rhaan', 'Раан', 'Rhaan', 'Начало осени', 'Письмо', 'Scribing'], ['sypheros', 'Сифероз', 'Sypheros', 'Середина осени', 'Тень', 'Shadow'],
    ['aryth', 'Арит', 'Aryth', 'Конец осени', 'Путь', 'Passage'], ['vult', 'Вульт', 'Vult', 'Начало зимы', 'Защита', 'Warding'],
  ];
  // Даты сверены по нескольким пересказам Eberron Campaign Setting, сами книги не открывал (docs/КАЛЕНДАРИ.md).
  const EBERRON_HOLIDAYS = {
    zarantyr: [h(14, 'Канун Возрождения', 'Rebirth Eve', 'flame')],
    olarune: [h(9, 'Хрустальное падение (Шарн)', 'Crystalfall', 'secular')],
    therendor: [h(15, 'Благословение Солнца (Дол Аррах)', "Sun's Blessing", 'host')],
    eyre: [h(15, 'Торжество Тронхолда', 'Thronehold', 'secular')],
    dravago: [h(26, 'Корона Аурейона', "Aureon's Crown", 'host')],
    nymm: [h(12, 'Светлый клинок (Дол Дорн)', 'Brightblade', 'host')],
    lharvion: [h(14, 'Серебряный прилив', 'Silvertide', 'flame')],
    barrakas: [h(4, 'Охота (Балинор)', 'The Hunt', 'host')],
    rhaan: [h(9, 'Пир Болдрей', "Boldrei's Feast", 'host')],
    sypheros: [hr(18, 19, 'Дикая ночь (Ярость)', 'Wildnight', 'six')],
    vult: [hr(26, 28, 'Долгие тени (Тень)', 'Long Shadows', 'six')],
  };
  const eberron = {
    id: 'eberron', ru: 'Эберрон', en: 'Galifar Calendar', world: 'Эберрон, Кхорвайр',
    era: { abbr: 'YK', ru: 'ГК', full: 'год Королевства (Years of the Kingdom)' }, defaultYear: 998,
    week: {
      mode: 'fixed', len: 7, label: 'неделя',
      names: [['Суль', 'Sul'], ['Моль', 'Mol'], ['Золь', 'Zol'], ['Вир', 'Wir'], ['Зор', 'Zor'], ['Фар', 'Far'], ['Сар', 'Sar']].map(([ru, en]) => ({ ru, en })),
    },
    accent: '#7d6fb0',
    layers: [
      { id: 'host', ru: 'Верховные Суверены', color: '#7d6fb0', on: true, note: 'пантеон Хозяев', src: 'Legendkeeper, Holy Days of the Sovereign Host' },
      { id: 'flame', ru: 'Серебряное Пламя', color: '#c8d3e0', on: true, note: 'церковь Фланы', src: 'пересказ ECS' },
      { id: 'six', ru: 'Тёмная Шестёрка', color: '#b0506b', on: true, note: 'тёмные боги', src: 'Legendkeeper, Wildnight and Long Shadows' },
      { id: 'secular', ru: 'Светские', color: '#d9a441', on: true, note: 'городские и государственные', src: 'пересказ ECS' },
    ],
    periods: () => EBERRON.map(([id, ru, en, seasonText, mark, markEn], i) => m(id, ru, en, 28, {
      n: i + 1, epithet: seasonText, mark: { ru: mark, en: markEn, label: 'знак дома' }, holidays: EBERRON_HOLIDAYS[id] ?? [],
      season: ['зима', 'зима', 'весна', 'весна', 'весна', 'лето', 'лето', 'лето', 'осень', 'осень', 'осень', 'зима'][i],
    })),
    notes: ['12 месяцев ровно по 28 дней, 4 недели: год 336 дней. Каждый месяц начинается с Суля и заканчивается Саром. Каждый месяц связан с одной из лун и со знаком дракона.',
      'Не внесены: Инициация и Ночь пекаря (даты не найдены).'],
  };

  // ---------- Грейхок (Общее летоисчисление, Флэнэс) ----------
  const GREYHAWK_GROUPS = [
    ['needfest', 'Праздник нужды', 'Needfest', 'зима', [['fireseek', 'Огнепоиск', 'Fireseek', 'зима'], ['readying', 'Приготовление', 'Readying', 'весна'], ['coldeven', 'Холодный вечер', 'Coldeven', 'весна']]],
    ['growfest', 'Праздник роста', 'Growfest', 'весна', [['planting', 'Посев', 'Planting', 'лето'], ['flocktime', 'Время стад', 'Flocktime', 'лето'], ['wealsun', 'Солнечный достаток', 'Wealsun', 'лето']]],
    ['richfest', 'Праздник достатка', 'Richfest', 'лето', [['reaping', 'Жатва', 'Reaping', 'лето'], ['goodmonth', 'Добрый месяц', 'Goodmonth', 'лето'], ['harvester', 'Сборщик', 'Harvester', 'лето']]],
    ['brewfest', 'Праздник пива', 'Brewfest', 'осень', [['patchwall', 'Заплатки', 'Patchwall', 'осень'], ['readyreat', 'Ридиррит', "Ready'reat", 'осень'], ['sunsebb', 'Закат солнца', 'Sunsebb', 'зима']]],
  ];
  const greyhawk = {
    id: 'greyhawk', ru: 'Грейхок', en: 'Common Year', world: 'Грейхок, Флэнэс',
    era: { abbr: 'CY', ru: 'ОЛ', full: 'Общее летоисчисление (Common Year)' }, defaultYear: 576,
    week: {
      mode: 'fixed', len: 7, label: 'неделя',
      names: [['Звёздный день', 'Starday'], ['Солнечный день', 'Sunday'], ['Лунный день', 'Moonday'], ['День богов', 'Godsday'], ['День воды', 'Waterday'], ['День земли', 'Earthday'], ['Свободный день', 'Freeday']].map(([ru, en]) => ({ ru, en })),
    },
    accent: '#6f9a5a',
    layers: [],
    periods() {
      const out = [];
      GREYHAWK_GROUPS.forEach(([fid, fru, fen, fseason, months]) => {
        out.push(f(fid, fru, fen, 7, { season: fseason, note: 'праздничная неделя между кварталами года' }));
        months.forEach(([id, ru, en, season]) => out.push(m(id, ru, en, 28, { season })));
      });
      return out.map((p, i) => ({ ...p, n: i + 1 }));
    },
    notes: ['12 месяцев по 28 дней и 4 праздничные недели между кварталами: 12×28 + 4×7 = 364 дня, ровно 52 недели. Каждый месяц и каждый праздник начинаются со Звёздного дня.',
      'Источники расходятся: старое «Folio» (через зеркало вики) даёт праздники по 6 дней и 360 дней в году; более поздняя вики даёт недельные праздники и 364. Взято 364 (решение Азазеля).',
      'Праздников по датам у Грейхока в найденных источниках нет, кроме самих праздничных недель. Русские названия месяцев дословная калька, официального перевода я не знаю.'],
  };

  // ---------- Обычный мир (григорианский календарь) ----------
  // Год: 12 месяцев, февраль 28 или 29 дней по правилу «кратен 4, кроме кратных 100, но не кратных 400».
  // Неделя сплошная, с понедельника; 1 января 2026 года четверг (weekAnchor.weekday: понедельник = 0).
  // Праздники лежат шаблонами-слоями: только даты, которые каждый год стоят на одном месте. Переходящие
  // (Пасха, Троица, День благодарения и т. п.) не включены: их день зависит от года.
  const earthLeap = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const EARTH_MONTHS = [
    ['january', 'Январь', 'January', 31, 'зима'], ['february', 'Февраль', 'February', 28, 'зима'], ['march', 'Март', 'March', 31, 'весна'],
    ['april', 'Апрель', 'April', 30, 'весна'], ['may', 'Май', 'May', 31, 'весна'], ['june', 'Июнь', 'June', 30, 'лето'],
    ['july', 'Июль', 'July', 31, 'лето'], ['august', 'Август', 'August', 31, 'лето'], ['september', 'Сентябрь', 'September', 30, 'осень'],
    ['october', 'Октябрь', 'October', 31, 'осень'], ['november', 'Ноябрь', 'November', 30, 'осень'], ['december', 'Декабрь', 'December', 31, 'зима'],
  ];
  const EARTH_GEN = {"january": "января", "february": "февраля", "march": "марта", "april": "апреля", "may": "мая", "june": "июня", "july": "июля", "august": "августа", "september": "сентября", "october": "октября", "november": "ноября", "december": "декабря"};
  const EARTH_HOL = {
    january: [
      h(1, 'Новый год', 'New Year’s Day', 'world'), hr(1, 8, 'Новогодние каникулы', 'New Year holidays', 'ru', { note: 'официальные выходные в России' }),
      h(6, 'Богоявление', 'Epiphany', 'catholic'), h(7, 'Рождество Христово', 'Orthodox Christmas', 'ru'), h(7, 'Рождество Христово (православное)', 'Orthodox Christmas', 'orthodox'),
      h(13, 'Старый Новый год (канун)', 'Old New Year’s Eve', 'ru', { note: 'неофициальный, по юлианскому календарю' }), h(14, 'Старый Новый год', 'Old New Year', 'ru', { note: 'неофициальный, по юлианскому календарю' }),
      h(19, 'Крещение Господне', 'Epiphany (Orthodox)', 'orthodox'),
    ],
    february: [
      h(2, 'Сретение (Candlemas)', 'Candlemas', 'catholic'), h(14, 'День святого Валентина', 'Valentine’s Day', 'world'),
      h(15, 'Сретение Господне', 'Meeting of the Lord', 'orthodox'), h(23, 'День защитника Отечества', 'Defender of the Fatherland Day', 'ru'),
    ],
    march: [h(8, 'Международный женский день', 'International Women’s Day', 'ru'), h(8, 'Международный женский день', 'International Women’s Day', 'world')],
    april: [h(1, 'День смеха', 'April Fools’ Day', 'world'), h(7, 'Благовещение', 'Annunciation', 'orthodox'), h(12, 'День космонавтики', 'Cosmonautics Day', 'ru'), h(22, 'День Земли', 'Earth Day', 'world')],
    may: [h(1, 'Праздник Весны и Труда', 'Spring and Labour Day', 'ru'), h(1, 'День труда', 'Labour Day', 'world'), h(9, 'День Победы', 'Victory Day', 'ru')],
    june: [h(1, 'День защиты детей', 'Children’s Day', 'ru'), h(12, 'День России', 'Russia Day', 'ru'), h(19, 'Juneteenth', 'Juneteenth', 'usa')],
    july: [h(4, 'День независимости', 'Independence Day', 'usa'), h(7, 'Рождество Иоанна Предтечи', 'Nativity of John the Baptist', 'orthodox'), h(12, 'День святых Петра и Павла', 'Sts Peter and Paul', 'orthodox')],
    august: [h(15, 'Успение Богородицы', 'Assumption of Mary', 'catholic'), h(19, 'Преображение Господне', 'Transfiguration', 'orthodox'), h(28, 'Успение Пресвятой Богородицы', 'Dormition', 'orthodox')],
    september: [h(1, 'День знаний', 'Knowledge Day', 'ru'), h(21, 'Рождество Богородицы', 'Nativity of the Theotokos', 'orthodox'), h(27, 'Воздвижение Креста', 'Exaltation of the Cross', 'orthodox')],
    october: [h(5, 'День учителя', 'Teachers’ Day', 'ru'), h(14, 'Покров Пресвятой Богородицы', 'Intercession of the Theotokos', 'orthodox'), h(31, 'Хэллоуин', 'Halloween', 'world')],
    november: [h(1, 'День всех святых', 'All Saints’ Day', 'catholic'), h(2, 'День поминовения усопших', 'All Souls’ Day', 'catholic'), h(4, 'День народного единства', 'Unity Day', 'ru'), h(11, 'День ветеранов', 'Veterans Day', 'usa')],
    december: [
      h(4, 'Введение во храм Богородицы', 'Presentation of the Theotokos', 'orthodox'), h(8, 'Непорочное зачатие', 'Immaculate Conception', 'catholic'),
      h(24, 'Сочельник', 'Christmas Eve', 'catholic'), h(25, 'Рождество Христово', 'Christmas', 'catholic'), h(25, 'Рождество', 'Christmas', 'world'), h(25, 'Рождество', 'Christmas Day', 'usa'),
      h(31, 'Канун Нового года', 'New Year’s Eve', 'world'), h(31, 'Канун Нового года', 'New Year’s Eve', 'ru'),
    ],
  };
  const earth = {
    id: 'earth', ru: 'Обычный мир', en: 'Gregorian calendar', world: 'Обычный мир, наше время',
    era: { abbr: 'CE', ru: 'н. э.', full: 'наша эра' }, defaultYear: 2026,
    week: {
      mode: 'continuous', len: 7, label: 'неделя',
      names: [['Понедельник', 'Monday'], ['Вторник', 'Tuesday'], ['Среда', 'Wednesday'], ['Четверг', 'Thursday'], ['Пятница', 'Friday'], ['Суббота', 'Saturday'], ['Воскресенье', 'Sunday']].map(([ru, en]) => ({ ru, en })),
    },
    weekAnchor: { year: 2026, weekday: 3 },
    accent: '#6aa9e0',
    /** Новая история в обычном мире начинается сегодня, по часам компьютера. */
    start: () => { const d = new Date(); const y = d.getFullYear(); return { year: y, doy: Math.round((Date.UTC(y, d.getMonth(), d.getDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1 }; },
    layers: [
      { id: 'ru', ru: 'Россия', color: '#c0584f', on: true, note: 'государственные и памятные даты', src: 'общеизвестные даты; переходящих праздников нет' },
      { id: 'world', ru: 'Международные', color: '#d9a441', on: true, note: 'Новый год, Валентин, Хэллоуин, Рождество', src: 'общеизвестные даты' },
      { id: 'orthodox', ru: 'Православные', color: '#9a7ad0', on: false, note: 'церковные даты, по новому стилю', src: 'православный календарь, непереходящие праздники; Пасхи и Троицы нет' },
      { id: 'catholic', ru: 'Католические и западные', color: '#5fb36f', on: false, note: 'церковные даты', src: 'общий римский календарь, непереходящие праздники' },
      { id: 'usa', ru: 'США', color: '#4aa3c8', on: false, note: 'федеральные даты с фиксированным числом', src: 'без переходящих (День благодарения, День труда и т. п.)' },
    ],
    // alias: родительный падеж, чтобы дату можно было набрать как «21 ноября»
    periods: year => EARTH_MONTHS.map(([id, ru, en, days, season], i) => m(id, ru, en, id === 'february' && earthLeap(year) ? 29 : days, { n: i + 1, season, alias: [EARTH_GEN[id]], holidays: EARTH_HOL[id] ?? [] })),
    notes: ['Григорианский календарь: 12 месяцев, февраль 29 дней в високосный год (кратен 4, кроме кратных 100 и не кратных 400). Неделя идёт сплошным кругом с понедельника.',
      'Праздники сложены шаблонами по слоям (Россия, Международные, Православные, Католические, США), включаются отдельно. Только непереходящие даты: Пасхи, Троицы и Дня благодарения нет.',
      'Новая история в этом мире начинается с сегодняшней даты. Фазы Луны считаются по среднему циклу 29,53 дня и могут отличаться от настоящих до суток.'],
  };

  // ---------- Общий движок ----------
  const CALENDARS = { harptos, exandria, golarion, eberron, greyhawk, earth };
  const ORDER = ['harptos', 'exandria', 'golarion', 'eberron', 'greyhawk', 'earth'];

  function yearLength(cal, year) { return cal.periods(year).reduce((s, p) => s + p.days, 0); }

  /** Дни от начала опорного года до начала года year (для сплошной недели). */
  function daysFromAnchor(cal, year) {
    const a = cal.weekAnchor?.year ?? cal.defaultYear;
    let total = 0;
    if (year >= a) for (let y = a; y < year; y++) total += yearLength(cal, y);
    else for (let y = year; y < a; y++) total -= yearLength(cal, y);
    return total;
  }

  /** Раскладывает номер дня в году на период и день в нём. */
  function locate(cal, year, doy) {
    const periods = cal.periods(year);
    let start = 1;
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (doy < start + p.days) return { period: p, index: i, day: doy - start + 1, start };
      start += p.days;
    }
    return null;
  }

  /** День недели (индекс); null для дней вне недели (праздники Харптоса). */
  function weekdayOf(cal, year, doy) {
    const loc = locate(cal, year, doy);
    if (!loc) return null;
    const mode = cal.week.mode;
    if (mode === 'tenday') return loc.period.type === 'festival' ? null : mod(loc.day - 1, cal.week.len);
    if (mode === 'fixed') return mod(loc.day - 1, cal.week.len);
    const shift = cal.weekAnchor?.weekday ?? 0;
    return mod(daysFromAnchor(cal, year) + (doy - 1) + shift, cal.week.len);
  }

  function seasonOf(cal, year, doy) {
    const loc = locate(cal, year, doy);
    if (!loc) return '';
    return loc.period.seasonFn ? loc.period.seasonFn(loc.period, loc.day) : (loc.period.season ?? '');
  }

  /** Слои, включённые по умолчанию, как Set id. */
  function defaultLayers(cal) { return new Set((cal.layers ?? []).filter(l => l.on).map(l => l.id)); }

  /** Праздники периода из включённых слоёв (с датой). enabled: Set id слоёв. */
  function holidaysOf(period, enabled) {
    return (period.holidays ?? []).filter(x => !enabled || enabled.has(x.layer));
  }
  /** Праздники «по луне» из включённых слоёв (без даты). */
  function moonHolidays(cal, enabled) {
    return (cal.moonHolidays ?? []).filter(x => !enabled || enabled.has(x.layer));
  }
  /** Сколько праздников каждого слоя в данном году (для подписи в списке). */
  function layerCounts(cal, year) {
    const counts = {};
    for (const p of cal.periods(year)) for (const x of p.holidays ?? []) counts[x.layer] = (counts[x.layer] ?? 0) + 1;
    for (const x of cal.moonHolidays ?? []) counts[x.layer] = (counts[x.layer] ?? 0) + 1;
    return counts;
  }

  /** Время суток по часам. */
  function partOfDay(minutes) {
    const hh = Math.floor(mod(minutes, 1440) / 60);
    if (hh >= 22 || hh < 5) return 'ночь';
    if (hh < 11) return 'утро';
    if (hh < 17) return 'день';
    return 'вечер';
  }

  /** Сдвиг даты на n дней (n может быть отрицательным). Возвращает { year, doy }. */
  function addDays(cal, date, n) {
    let { year, doy } = date;
    doy += n;
    while (doy > yearLength(cal, year)) { doy -= yearLength(cal, year); year++; }
    while (doy < 1) { year--; doy += yearLength(cal, year); }
    return { year, doy };
  }

  const api = { CALENDARS, ORDER, yearLength, locate, weekdayOf, seasonOf, partOfDay, addDays, daysFromAnchor, defaultLayers, holidaysOf, moonHolidays, layerCounts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SJ_CAL = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
