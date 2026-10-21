// Badge copy and icons. Who has earned what is decided by the database
// (run_evaluate_achievements); this file only describes them.
// Most reward showing up, not speed.
export const ACHIEVEMENTS = [
  { code: 'first_run', icon: 'shoe', ms: ['Larian Pertama', 'Rekod larian pertama anda'], en: ['First Run', 'Log your first run'] },
  { code: 'first_workout', icon: 'check', ms: ['Sesi Pertama', 'Siapkan sesi pertama pelan'], en: ['First Session', 'Complete your first plan session'] },
  { code: 'first_5k', icon: 'flag', ms: ['5KM Pertama', 'Lari 5KM sekali jalan'], en: ['First 5KM', 'Run 5KM in one go'] },
  { code: 'first_10k', icon: 'flag', ms: ['10KM Pertama', 'Lari 10KM sekali jalan'], en: ['First 10KM', 'Run 10KM in one go'] },
  { code: 'first_half', icon: 'medal', ms: ['Separuh Maraton', 'Lari 21.1KM'], en: ['Half Marathon', 'Run 21.1KM'] },
  { code: 'workouts_10', icon: 'star', ms: ['10 Sesi Latihan', 'Siapkan 10 sesi pelan'], en: ['10 Training Sessions', 'Complete 10 plan sessions'] },
  { code: 'consistency_4w', icon: 'calendar', ms: ['Konsisten 4 Minggu', 'Lari setiap minggu, 4 minggu berturut'], en: ['4-Week Consistency', 'Run every week for 4 weeks in a row'] },
  { code: 'first_club_run', icon: 'people', ms: ['Larian Kelab Pertama', 'Sertai larian komuniti HITFAT'], en: ['First Club Run', 'Join a HITFAT community run'] },
  { code: 'month_50k', icon: 'fire', ms: ['50KM Sebulan', 'Kumpul 50KM dalam sebulan'], en: ['50KM Month', 'Run 50KM in a month'] },
  { code: 'month_100k', icon: 'fire', ms: ['100KM Sebulan', 'Kumpul 100KM dalam sebulan'], en: ['100KM Month', 'Run 100KM in a month'] },
  { code: 'plan_complete', icon: 'trophy', ms: ['Pelan Tamat', 'Siapkan setiap sesi satu pelan'], en: ['Plan Complete', 'Finish every session of a plan'] },
];
export const byCode = c => ACHIEVEMENTS.find(a => a.code === c);
