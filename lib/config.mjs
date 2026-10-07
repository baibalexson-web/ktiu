export const PAGE_URL = 'https://agatu.ru/obuchauschimsya/raspisanie/';
export const SOURCES = [
  {key:'it', code:'09.02.07', short:'ИСиП', title:'Информационные системы и программирование', filename:'it.pdf'},
  {key:'software', code:'09.02.11', short:'Разработка ПО', title:'Разработка и управление программным обеспечением', filename:'software.pdf'},
  {key:'heat', code:'13.02.02', short:'Теплоснабжение', title:'Теплоснабжение и теплотехническое оборудование', filename:'heat.pdf'},
  {key:'zoo', code:'36.02.03', short:'Зоотехния', title:'Зоотехния', filename:'zoo.pdf'},
  {key:'accounting', code:'38.02.01', short:'Бухгалтерский учёт', title:'Экономика и бухгалтерский учёт (по отраслям)', filename:'accounting.pdf'},
  {key:'culinary', code:'43.02.15', short:'Поварское дело', title:'Поварское и кондитерское дело', filename:'culinary.pdf'},
  {key:'law', code:'40.02.04', short:'Юриспруденция', title:'Юриспруденция', filename:'law_v2.pdf'}
];
export const SOURCE_KEYS = SOURCES.map(s=>s.key);
export const MAX_PDF = 15 * 1024 * 1024;
