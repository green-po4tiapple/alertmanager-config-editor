/**
 * Russian dictionary — the reference shape for every other language.
 *
 * Rules of the road:
 *  - values with substitutions are functions, so string assembly never leaks into
 *    components and translators see the whole sentence;
 *  - namespaces mirror where the text is used (`parse`, `enrich`, `batch`, …);
 *  - `en.ts` is typed as `Dict`, so a missing or renamed key fails the build.
 */

export const ru = {
  /* ------------------------------- src/core -------------------------------- */

  outcome: {
    delivered: { label: 'доставлено', note: '' },
    'drop-null': {
      label: 'дроп (явный null)',
      note:
        'receiver с именем "null" — осознанный дроп: ветка существует именно для того, ' +
        'чтобы гасить такие алерты.',
    },
    'drop-no-receiver': {
      label: "дроп (нет receiver'а на этой ветке)",
      note:
        "У этой ветки нет своего receiver'а, и ни один дочерний матчер не совпал. " +
        'Receiver НЕ наследуется от родителя — итоговый receiver пустой, алерт молча теряется.',
    },
  },

  change: {
    added: 'добавлена',
    modified: 'изменена',
    moved: 'перемещена',
    'moved-modified': 'перемещена и изменена',
  },

  resolution: {
    exact: 'посчитано',
    'no-series': 'нет серий — алертов нет',
    unresolved: 'нужны лейблы серий',
  },

  matcher: {
    emptyString: 'пустая строка',
    multipleInOneLine: 'несколько матчеров в одной строке — разнесите по отдельным строкам',
    noOperator: 'нет оператора (=, !=, =~, !~)',
    noLabelName: 'не указано имя лейбла',
    badLabelName: (label: string): string => `недопустимое имя лейбла: ${label}`,
    unclosedQuote: 'незакрытая кавычка в значении',
    inlineFlagNotAtStart:
      'inline-флаг (?…) стоял не в начале паттерна — в JS такое невозможно, ' +
      'флаг применён ко всему выражению (в Go он действовал бы только до конца группы)',
    unsupportedRegexFlag: (flag: string): string => `неподдерживаемый флаг регулярки: (?${flag})`,
    invalidRegex: (message: string): string => `невалидная регулярка: ${message}`,
  },

  endpoint: {
    schemeAdded: (url: string): string => `схема подставлена: ${url}`,
    addressReplaced: (url: string): string => `адрес заменён на ${url}`,
  },

  parse: {
    emptyInput: 'Пустой ввод — вставьте YAML.',
    yamlFailed: (message: string): string => `YAML не разобрался: ${message}`,
    expectedMapping:
      'Ожидался YAML-маппинг: либо весь конфиг с ключом route:, либо сам блок route: ' +
      '(receiver/matchers/routes), либо список веток через «- ».',
    noRouteKey: (keys: string): string =>
      'Не нашёл ни ключа route:, ни признаков route-блока. Ключи верхнего уровня: ' +
      `${keys || '(нет)'}.`,
    nestedRoute: (path: string): string =>
      `Блок route: найден не на верхнем уровне, а по пути ${path} — похоже на ` +
      'HelmRelease/ConfigMap. Экспорт «весь файл» подставит блок на то же место.',
    routeMustBeMapping: 'Ключ route: должен быть маппингом.',
    dedented: (spaces: number): string =>
      `Вставка была со сдвигом на ${spaces} пробел(ов) — отступ снят перед разбором.`,
    routesFragmentWrapped: 'Вставлен фрагмент списка веток — он подвешен под корневой route:.',
    continueMustBeBool: (where: string, got: string): string =>
      `${where}: continue должен быть true/false, получено ${got}.`,
    routesMustBeList: (where: string): string =>
      `${where}: routes: должен быть списком — проигнорирован.`,
    routeNotMapping: (where: string): string => `${where}: не маппинг — ветка пропущена.`,
    receiverYamlNull: (where: string): string =>
      `${where}: receiver: null без кавычек — это YAML-null, а не имя receiver'а «null». ` +
      'Трактую как «receiver не задан».',
    receiverNotString: (where: string, type: string): string =>
      `${where}: receiver не строка (${type}) — приведён к строке.`,
    matchersMustBeList: (where: string): string =>
      `${where}: matchers: должен быть списком строк — проигнорирован.`,
    matcherItemNotString: (where: string): string =>
      `${where}: элемент matchers не строка — приведён к строке.`,
    legacyMustBeMapping: (where: string, origin: string): string =>
      `${where}: ${origin}: должен быть маппингом — проигнорирован.`,
    legacyDeprecated: (where: string, origin: string, op: string): string =>
      `${where}: ключ ${origin}: устарел (deprecated в Alertmanager). Показан как матчер ` +
      `«label${op}"value"»; при экспорте вернётся обратно в ${origin}:.`,
    receiversNotList: 'receivers: не список — имена receiver’ов не извлечены.',
  },

  source: {
    emptyInput: 'Пустой ввод.',
    yamlFailed: (message: string): string => `YAML не разобрался: ${message}`,
    jsonFailed: (message: string): string => `JSON не разобрался: ${message}`,
    noAlertingRules:
      'Не нашёл ни одного alerting-правила. Ожидается дамп PrometheusRule, ' +
      'rule-файл с ключом groups: или JSON из API Prometheus/Alertmanager.',
    noAlertingRulesInApi: 'В ответе /api/v1/rules нет alerting-правил.',
    emptyArray: 'Массив пуст или в элементах нет labels.',
    expectedObjectOrArray: 'Ожидался объект или массив.',
    unknownJson: 'Не понял JSON. Ожидается ответ /api/v1/rules, /api/v1/alerts или /api/v2/alerts.',
    csvNeedsHeaderAndRow: 'В CSV нужна строка-шапка и хотя бы одна строка данных.',
    csvNoDataRows: 'В CSV не нашлось ни одной строки с данными.',
    csvRow: (index: number): string => `строка ${index}`,
    noAlertname: '(без alertname)',
    firingAlert: 'горящий алерт',
    labelsNotMapping: (where: string): string => `${where}: labels не маппинг — проигнорированы.`,
  },

  batch: {
    noExternalLabels: 'без внешних лейблов',
    noMatchers: '(без матчеров)',
  },

  enrich: {
    noAddress: 'адрес не указан',
    badStatus: (status: string): string => `ответ status=${status}`,
    version: (version: string): string => `версия ${version}`,
    connected: 'соединение есть',
    noConfigOriginal: 'в ответе /api/v2/status нет config.original',
    noExpr: 'у правила нет expr — разворачивать нечего',
    firingNow: (count: number): string =>
      `правило горит сейчас: ${count} набор(ов) лейблов из выражения`,
    notFiringUsedRelaxed: (count: number): string =>
      `правило сейчас не горит; лейблы взяты из выражения без порога (${count})`,
    metricMissing: (metric: string): string =>
      `метрики ${metric} в этой TSDB нет вовсе — экспортёр молчит либо данные пишутся ` +
      'в другой Prometheus',
    metricPresentNoMatch: (metric: string, count: number): string =>
      `метрика ${metric} есть (${count} серий), но под фильтры выражения не попало ни одной — ` +
      'проверьте матчеры в expr',
    noMetricInExpr: 'в выражении не нашлось метрики',
    timeout: 'таймаут запроса',
  },

  /* ------------------------------ interface -------------------------------- */

  common: {
    close: 'Закрыть',
    clear: 'Очистить',
    expand: 'Развернуть',
    collapse: 'Свернуть',
  },

  sourceDialog: {
    title: 'Оригинал вставленного конфига (только чтение)',
    intro: (lines: number): string =>
      `Это исходный текст ровно в том виде, в котором он был получен: ${lines} строк. ` +
      'Редактор его не перезаписывает — все правки живут в отдельной рабочей копии дерева.',
    fromApi: (url: string): string =>
      `Источник — \`${url}\` (\`/api/v2/status\`), секреты в нём заменены самим Alertmanager ` +
      'на `<secret>`.',
    showWholeFile: 'показать весь файл (включая `receivers:` с токенами)',
  },

  search: {
    title: 'Поиск по дереву',
    matches: (count: number): string => `${count} совпадений`,
    placeholder: 'receiver или матчер, напр. oncall',
    nothingFound: 'Ничего не нашлось ни в receiver’ах, ни в матчерах.',
    goToRoute: 'Перейти к ветке',
    matcher: 'матчер',
    level: (depth: number): string => `ур. ${depth}`,
  },

  inspector: {
    title: 'Выбранная ветка',
    rootTitle: 'Корневая ветка route',
    empty: 'Кликните по блоку на диаграмме, чтобы отредактировать его здесь.',
    level: (n: number): string => `уровень ${n}`,
    children: (n: number): string => `детей: ${n}`,
    goToParent: 'Перейти к родительской ветке',
    rootRoute: 'корень route',
    noMatchers: 'без матчеров',
    untouchedKeys: 'Ключи, которые редактор не трогает, но сохранит при экспорте:',
  },

  block: {
    title: 'Дерево роутинга — блочный режим',
    hint:
      'Порядок веток значим: срабатывает первая совпавшая на этом уровне, если у неё нет ' +
      '`continue`. Тусклые карточки — `receiver: "null"` (осознанный дроп). Правки ' +
      'применяются сразу; `⌘/Ctrl+Z` — отмена.',
    ariaRoot: 'корневая ветка route',
    ariaRoute: 'ветка роутинга',
    noChildren: 'Нет дочерних веток',
  },

  tester: {
    title: 'Проверка алерта',
    clearHighlight: 'снять подсветку',
    hint:
      'Задайте лейблы гипотетического алерта. Отсутствующий лейбл трактуется как пустая ' +
      'строка — именно так это работает в Alertmanager.',
    removeLabel: 'Убрать лейбл',
    addLabel: '+ лейбл',
    run: 'Проверить →',
    nothingMatched:
      'Ни одна ветка не совпала — даже корень. Такое возможно только если у корня есть ' +
      'матчеры, которые не прошли.',
    multiplePaths: (count: number): string =>
      `Совпало ${count} путей — из-за \`continue: true\` алерт уедет во все перечисленные ` +
      'receiver’ы одновременно.',
    receiverUnset: '(receiver не задан)',
    pathOf: (index: number, total: number): string => `путь ${index}/${total}`,
    showRoute: 'Показать эту ветку',
    rootRoute: 'корень route',
    routeWithoutMatchers: 'ветка без матчеров',
  },

  graph: {
    title: 'Дерево роутинга — графовый режим',
    hintRadial:
      'Корень в центре, уровни расходятся кольцами — как в официальном routing-tree-editor. ' +
      'Клик по узлу — выделить и открыть инспектор справа, двойной клик — свернуть или ' +
      'развернуть поддерево.',
    hintVertical:
      'Корень сверху, ветки расходятся вниз, матчеры видны прямо в блоках. Перетащите блок ' +
      'на другой, чтобы сделать его дочерним; двойной клик — свернуть или развернуть; ' +
      'тянуть по пустому месту — панорама.',
    radial: 'Радиальный',
    radialTitle: 'Как в официальном routing-tree-editor Prometheus',
    vertical: 'Блоки',
    verticalTitle: 'Блоки с матчерами, drag&drop веток',
    fitToScreen: 'Вписать в экран',
    collapseAll: 'Свернуть всё',
    expandAll: 'Развернуть всё',
    focus: 'Фокус',
    focusTitle: 'Показать только выделенное поддерево (модель не меняется)',
    focusUp: 'выше',
    focusUpTitle: 'На уровень выше',
    wholeRoute: 'весь route',
    focusOn: (what: string): string => `фокус: ${what}`,
    nodeCount: (n: number): string => `${n} узлов`,
    rootTooltip: 'route (корень)',
    receiverUnset: '(не задан)',
    receiverUnsetDash: '— receiver не задан —',
    collapsedCount: (n: number): string => `свёрнуто веток: ${n}`,
    dragHint: 'перетащите на другой блок, чтобы переподвесить',
    alwaysMatches: '(матчится всегда)',
    moreMatchers: (n: number): string => `+${n} матчер(а)`,
    dropToAttach: 'отпустите — станет дочерней',
    hoverAParent: 'наведите на будущего родителя',
  },

  route: {
    matcherHint:
      'label="value" | label!="value" | label=~"regex" | label!~"regex". ' +
      'Регулярка сравнивается целиком (^(?:…)$), допустим префикс (?i).',
    legacyMatcherHint: (origin: string): string =>
      `Приехал из legacy-ключа ${origin}: — при экспорте вернётся туда же.`,
    removeMatcher: 'Удалить матчер',
    addMatcher: '+ матчер',
    didNotMatch: 'не совпал: фактическое значение',
    labelAbsent: '«» (лейбла нет)',
    rootAlwaysMatches: 'корень — матчится всегда',
    noMatchersMatchesAll: 'без матчеров — совпадёт с любым алертом',
    receiverUnsetPlaceholder: '— не задан —',
    receiverUnknown: 'Такого имени нет в блоке receivers: вставленного конфига',
    receiverHint:
      'Имя receiver’а. Пусто = ключа receiver нет (алерт молча теряется). ' +
      '"null" = осознанный дроп.',
    commaSeparated: 'Список через запятую',
    badgeContinue: 'После совпадения идём к следующим соседям',
    badgeNull: 'Осознанный дроп',
    badgeNoReceiver: 'нет receiver',
    badgeNoReceiverTitle:
      'Нет своего receiver’а: если ни один ребёнок не совпадёт, алерт молча потеряется',
    badgeLeafNoReceiver: 'лист без receiver',
    badgeLeafNoReceiverTitle: 'Лист без receiver’а — алерт теряется',
    badgeGoesHere: 'сюда уедет',
    badgeExtra: (n: number): string => `+${n} ключ(а)`,
    badgeExtraTitle: (keys: string): string => `Сохраняются при экспорте: ${keys}`,
    moveUp: 'Выше среди соседей',
    moveDown: 'Ниже среди соседей',
    indent: 'Сделать дочерней у предыдущего соседа',
    outdent: 'Поднять на уровень выше',
    addChild: '+дочерняя',
    addChildTitle: 'Добавить дочернюю ветку',
    addSibling: '+соседняя',
    addSiblingTitle: 'Добавить соседнюю ветку',
    removeRoute: 'Удалить ветку',
  },

  exportDialog: {
    title: 'Экспорт YAML',
    size: (lines: number, bytes: number): string => `${lines} строк · ${bytes} байт`,
    download: 'Скачать файл',
    copy: 'Скопировать',
    copied: 'Скопировано в буфер',
    copyFailed: 'Не удалось скопировать — выделите текст вручную',
    saved: 'Файл сохранён',
    tabRoute: 'Только блок route:',
    tabFile: 'Весь файл',
    tabFileTitle: 'Оригинальный файл с заменённым блоком route:',
    tabFileDisabledApi:
      'Недоступно: конфиг взят из API Alertmanager, в нём секреты заменены на <secret>',
    tabFileNeedsWholeFile: 'Доступно, только если был вставлен весь файл',
    tabDiff: 'Изменения',
    tabDiffTitle: 'Что именно изменилось относительно загруженного конфига',
    tabDiffNone: '(нет)',
    hintDiff:
      'Сравнение с деревом на момент загрузки. Оба текста прогнаны через один и тот же ' +
      'сериализатор, поэтому в диффе видны только реальные правки, а не разница в ' +
      'оформлении YAML.',
    hintRoute:
      'Готовый блок `route:` — вставьте его вместо старого в `alertmanager_config.yaml`. ' +
      'Порядок ключей нормализован, смысл и структура сохранены точно; строки матчеров не ' +
      'перекавычены.',
    hintFile:
      'Исходный вставленный файл, в котором заменён только блок `route:`. Всё остальное — ' +
      '`receivers:`, `inhibit_rules:`, комментарии — взято из оригинала дословно.',
    apiSecretsNote:
      '⚠️ Конфиг взят из API Alertmanager, поэтому в исходнике вместо токенов стоит ' +
      '`<secret>`. Блок `route:` ниже секретов не содержит и пригоден к вставке как есть, ' +
      'а вкладка «весь файл» отключена намеренно.',
    noChanges:
      'Дерево не отличается от загруженного — правок нет (или они друг друга скомпенсировали).',
    selfCheckUnparsable: (error: string): string => `⚠ Экспорт не разбирается обратно: ${error}`,
    selfCheckInvalidMatchers: (count: number, examples: string): string =>
      `⚠ В дереве ${count} невалидный(х) матчер(ов) — Alertmanager такой конфиг не примет: ` +
      examples,
  },

  load: {
    title: 'Дерево роутинга Alertmanager',
    lede:
      'Показывает дерево роутинга целиком и прогоняет через него **всю вашу выгрузку алертов ' +
      'разом** — включая те, что не доходят ни до одного receiver’а и теряются молча. Дерево ' +
      'тут же правится, YAML забирается готовым.',
    exampleHint: 'Демо-конфиг с двумя типичными дефектами внутри. Своих данных не нужно.',
    orYourOwn: 'или загрузите свой конфиг',
    subtitle:
      'Вставьте `alertmanager.yml` целиком либо только блок `route:` (можно и просто список ' +
      'веток со `- matchers:`) — или HelmRelease, внутри которого он лежит.',
    pullTitle: 'Взять из работающего Alertmanager',
    pullHint:
      '`GET /api/v2/status` → `config.original`. Схему можно не писать — подставится `https`, ' +
      'а `http` при неудаче будет повторён на `https` автоматически. Alertmanager отдаёт ' +
      'конфиг с замаскированными секретами (`bot_token: <secret>`), поэтому для правки дерева ' +
      'это самый безопасный источник — но вернуть такой файл в кластер целиком нельзя, ' +
      'экспорт «весь файл» для него отключается.',
    pullButton: 'Загрузить конфиг',
    pullBusy: 'Загружаю…',
    authNeeded: 'нужна аутентификация',
    username: 'логин',
    password: 'пароль',
    loadTree: 'Загрузить дерево',
    openFile: 'Открыть файл…',
    loadExample: 'Посмотреть на примере →',
    dropHint: 'или перетащите файл в поле · ⌘/Ctrl+Enter',
    factSecrets:
      '**Секреты.** Если вставить файл целиком, из блока `receivers:` берутся только имена. ' +
      'Токены, URL и `*_configs` в состояние приложения не переносятся вообще, включая ' +
      'sops-шифртексты в HelmRelease.',
    factNetwork:
      '**Сеть.** Приложение ходит наружу только по вашей кнопке и только на адреса, которые ' +
      'вы ввели: конфиг из Alertmanager, правила и горящие алерты, а в режиме «Пакетно» — ' +
      'обогащение лейблов из Prometheus/VM. Дерево роутинга и вставленный конфиг не ' +
      'отправляются никогда.',
    factOriginal:
      '**Оригинал неизменен.** Вставленный текст хранится отдельно и не перезаписывается ' +
      'никакими действиями в интерфейсе. Итоговый YAML появляется только по кнопке «Экспорт».',
    amHttpError: (status: string): string =>
      `Alertmanager ответил ${status} — адрес доступен, но /api/v2/status не отдал конфиг.`,
    amNetworkError: (message: string, tried: string): string =>
      `Не получилось забрать конфиг: ${message}. Пробовал ${tried}. Проверьте, что адрес ` +
      'доступен из этой сети и отдаёт CORS-заголовки.',
  },

  app: {
    tagline: 'разбор в браузере · конфиг наружу не уходит',
    viewBlocks: 'Блочный',
    viewGraph: 'Граф',
    viewBatch: 'Пакетно',
    viewBatchTitle: 'Прогнать выгрузку алертов по текущему дереву',
    undo: 'Отменить',
    redo: 'Повторить',
    original: 'Оригинал',
    exportYaml: 'Экспорт YAML',
    loadAnother: 'Другой конфиг',
    loadAnotherTitle: 'Вернуться к экрану вставки — текущие правки будут потеряны',
    loadAnotherConfirm: 'Загрузить другой конфиг? Текущие правки будут потеряны.',
    theme: 'Тема',
    themeAuto: 'авто',
    receiversTitle: 'Receiver’ы',
    receiversHint:
      'Из блока `receivers:` взяты только имена — они подставляются в автодополнение. ' +
      'Тусклые не используются ни одной веткой.',
    receiverUsed: 'используется в дереве',
    receiverUnused: 'не используется ни одной веткой',
    parseWarnings: 'Замечания разбора',
    changesTitle: 'Изменения',
    onlyChanged: 'только изменённые',
    changedCount: (n: number): string => `Правок в ветках: ${n}`,
    removedCount: (n: number): string => ` · удалено веток: ${n}`,
    changesFilterHint:
      '. Тумблер оставляет в дереве только изменённые ветки и их родителей.',
    noChangesYet:
      'Дерево совпадает с загруженным — правок нет. Здесь появится фильтр, как только ' +
      'что-нибудь поменяете.',
    treeTitle: 'Дерево',
    treeStats: (nodes: number, depth: number, past: number, future: number): string =>
      `Веток: ${nodes} · глубина: ${depth} · история: ${past} шаг(ов) назад, ${future} вперёд`,
    noPreviousSibling: 'Нет предыдущего соседа, к которому можно подвесить',
    alreadyTopLevel: 'Ветка уже на верхнем уровне',
    cannotMoveFurther: 'Дальше двигать некуда',
    cannotReparentIntoItself: 'Так переподвесить нельзя: ветку нельзя вложить в саму себя',
    reparented: 'Ветка переподвешена',
    confirmDelete: (kids: number): string => `Удалить ветку вместе с вложенными (${kids})?`,
  },

  batchUi: {
    title: 'Пакетная проверка',
    intro:
      'Загрузите выгрузку алертов — увидите, куда уедет каждый по текущему (отредактированному) ' +
      'дереву. Маршрут показывается, только когда он доказан: у правил Prometheus известны лишь ' +
      'статические `labels:`, поэтому правило сначала разворачивается в реальные серии запросом ' +
      'к TSDB, а до тех пор receiver не выводится вовсе.',

    step1: '1. Подключения (необязательно)',
    step1Hint:
      'Адреса вводите сами — в коде ничего не зашито. Схему можно не писать: подставится ' +
      '`https`, а `http` при неудаче будет повторён на `https` автоматически. Наружу уходят ' +
      'только запросы к этим адресам; дерево роутинга и вставленный конфиг не отправляются ' +
      'никогда.',
    check: 'Проверить',
    checking: 'проверяю…',
    authRequired: 'требуется аутентификация (basic)',
    credentialsNote:
      'Хранится только в памяти вкладки и уходит заголовком Authorization на указанные адреса.',

    step2: '2. Источник алертов',
    step2Hint:
      'Проще всего — вытянуть по API из блока выше. Либо вставьте или перетащите файл: ' +
      'понимается дамп `PrometheusRule` (`kubectl get prometheusrule -A -o yaml`), rule-файл, ' +
      'ответ `/api/v1/rules`, выгрузка `/api/v2/alerts` или CSV с шапкой из имён лейблов.',
    pullRules: 'Правила из Prometheus',
    pullRulesTitle: 'GET /api/v1/rules?type=alert — все alerting-правила',
    pullAlerts: 'Горящие алерты из Alertmanager',
    pullAlertsTitle: 'GET /api/v2/alerts — то, что горит прямо сейчас (лейблы полные)',
    fetching: 'загружаю…',
    sourceIs: (from: string): string => `источник: ${from}`,
    loadDump: 'Загрузить выгрузку',
    loadedAlerts: (n: number): string => `Загружено алертов: ${n}`,
    format: {
      'prometheus-rule-crd': 'дамп PrometheusRule из кластера',
      'prometheus-rule-file': 'rule-файл Prometheus',
      'prometheus-rules-api': 'ответ /api/v1/rules',
      'alerts-api': 'горящие алерты (лейблы полные)',
      csv: 'CSV',
    },
    alertCount: (n: number): string => `алертов: ${n}`,

    step3: '3. Внешние лейблы',
    step3Hint:
      'То, что Prometheus добавляет сам (`cluster`, `location`) — в выгрузке правил их нет, а ' +
      'роутинг на них смотрит. Несколько значений через запятую дают отдельный прогон на ' +
      'каждое: сразу видно, где поведение в разных кластерах расходится.',
    remove: 'Убрать',
    addExternalLabel: '+ внешний лейбл',
    variantCount: (n: number, list: string): string => `Вариантов прогона: ${n} (${list})`,

    step4: '4. Обогащение лейблами из Prometheus / VictoriaMetrics',
    step4Hint:
      'Нужно, если источник — правила (у них известны только статические `labels:`). Для ' +
      'выгрузки горящих алертов не требуется: там лейблы и так настоящие. Наружу уходят ' +
      '**только выражения правил** на адрес из блока 1.',
    enableEnrichment: 'обогащать лейблы запросами к TSDB',
    seriesPerRule: 'серий на правило',
    enrichLabels: 'Обогатить лейблы',
    enriching: (done: number, total: number): string => `Обогащаю… ${done}/${total}`,
    abort: 'Прервать',
    aborted: 'Прервано.',
    needPromUrl: 'Укажите адрес Prometheus/VM в блоке 1.',
    noExprInDump: 'В выгрузке нет выражений (expr) — обогащать нечего.',
    enrichSummary: (
      exact: number,
      approx: number,
      noData: number,
      noMatch: number,
      errors: number,
    ): string =>
      `Правило горит (точные лейблы): ${exact} · развёрнуто без порога: ${approx} · ` +
      `метрики нет в TSDB: ${noData} · фильтры не совпали: ${noMatch} · ошибок: ${errors}`,
    expanding: (name: string): string => `разворачиваю ${name}…`,

    httpAnswered: (status: string): string =>
      `${status} — адрес отвечает, но не тем: проверьте путь и права.`,
    causesHttps:
      'Возможные причины: сервис недоступен из сети, нет CORS-заголовков либо ' +
      'самоподписанный сертификат.',
    causesHttp: 'Возможные причины: сервис недоступен из сети или не отдаёт CORS-заголовки.',
    requestFailed: (message: string, tried: string, causes: string): string =>
      `${message}. Пробовал ${tried}. ${causes}`,

    result: 'Результат',
    resultCounts: (rows: number, alerts: number): string => `строк: ${rows} · алертов: ${alerts}`,
    notShown: (n: number): string => ` · не показано: ${n}`,
    statDelivered: 'доставлено',
    statDropNull: 'дроп (явный null)',
    statLost: 'потеряно',
    statUnresolved: 'не развёрнуто в алерты',
    statNoSeries: 'нет серий',
    statChanged: 'маршрут изменился',
    statMulti: 'несколько receiver’ов',
    regressionNote: (changed: number, rows: number): string =>
      `Ваши правки дерева переадресуют **${changed}** из ${rows} строк. Фильтр «маршрут ` +
      'изменился» показывает только их — это и есть регрессия правки: не дифф YAML, а дифф ' +
      'поведения.',
    unresolvedNote: (n: number): string =>
      `${n} правил(а) не развёрнуты в алерты, поэтому маршрут для них не считался: правило — ` +
      'это шаблон, лейблы серии появляются только при срабатывании.',
    expandAllViaProm: 'развернуть все через Prometheus',
    unresolvedNeedProm:
      'Укажите адрес Prometheus в блоке 1 — тогда их можно развернуть в реальные алерты.',
    noReceiverBucket: '(нет receiver’а)',
    emptyName: '(пусто)',

    filterAll: 'все',
    filterUnresolved: 'не развёрнуто',
    filterMulti: 'несколько',
    searchPlaceholder: 'фильтр по алерту, лейблу, receiver’у',
    copyCsv: 'Копировать CSV',
    copiedRows: (n: number): string => `Скопировано строк: ${n}`,
    downloadCsv: 'Скачать CSV',
    downloadMarkdown: 'Скачать markdown',

    colAlert: 'Алерт',
    colLabels: 'Известные лейблы',
    colOutcome: 'Исход',
    colWhy: 'Почему',
    truncatedTable: (total: number): string =>
      `Показаны первые 500 строк из ${total}. Уточните фильтр или выгрузите CSV.`,
    seriesOf: (index: number, total: number): string => `серия ${index}/${total}`,
    enrichmentLabel: 'обогащение',
    didNotMatchBefore: '(не совпадало)',
    whyNoSeries:
      'Правило сейчас не даёт ни одной серии — алертов из него нет, маршрутизировать нечего.',
    whyUnresolved: (labels: string): string =>
      `Правило не развёрнуто в алерты. Дерево спрашивает у этого алерта \`${labels}\`; эти ` +
      'лейблы появляются только в момент срабатывания.',

    detailBefore: 'Было до правок',
    noRouteMatched: 'не совпадала ни одна ветка',
    detailAfter: 'Стало сейчас',
    detailPath: 'Путь по дереву',
    detailBlockers: 'Какие ветки зависят от неизвестных лейблов',
    detailBlockersHint:
      'Пока правило не развёрнуто в реальные алерты, решение по этим веткам принять ' +
      'невозможно — поэтому маршрут не показывается.',
    showRoute: 'показать ветку',
    expandViaProm: 'Развернуть в алерты через Prometheus',
    openInProm: 'Открыть в Prometheus',
    withoutThreshold: 'Без порога',
    withoutThresholdTitle:
      'То же выражение без финального порога — видно серии, даже если правило не горит',
    detailAttempts: 'Какие запросы были сделаны',
    attempt: {
      expr: 'выражение как есть',
      'expr-without-threshold': 'без финального порога',
      'series-exists': 'есть ли метрика вообще',
    },
    seriesCount: (n: number): string => `серий: ${n}`,
  },
};
