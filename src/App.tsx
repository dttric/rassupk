/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Calendar,
  Clock,
  User,
  MapPin,
  Search,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Info,
  Layers,
  CheckCircle,
  HelpCircle,
  Filter,
  Bookmark,
  Smartphone
} from "lucide-react";

// Types for select options
interface Option {
  value: string;
  label: string;
}

interface ScheduleItem {
  weekType: string;
  dayName: string;
  date: string; // "DD.MM.YYYY"
  lessonNumber: number;
  time: string; // "10:15-11:50"
  subject: string;
  stream: string;
  classroom: string;
  teacher: string;
}

interface SavedPreferences {
  id_Forma: string;
  id_Fak: string;
  Kurs: string;
  NamePodGrup: string;
  RangeNedel: string;
  groupLabel: string;
}

// Helper to convert date to "DD.MM.YYYY"
function formatDateStr(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

// Helper to parse "DD.MM.YYYY" string to JS Date
function parseDateStr(str: string): Date {
  const parts = str.split(".");
  return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
}

// Generate array of Dates within "DD.MM.YYYY - DD.MM.YYYY"
function generateRangeDates(rangeStr: string): Date[] {
  const match = rangeStr.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) return [];
  const start = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
  const end = new Date(parseInt(match[6]), parseInt(match[5]) - 1, parseInt(match[4]));

  const dates: Date[] = [];
  const curr = new Date(start);
  while (curr <= end) {
    dates.push(new Date(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

// Determine if today falls inside the fortnight range
function findDefaultDate(dates: Date[]): Date {
  const todayStr = formatDateStr(new Date());
  const found = dates.find((d) => formatDateStr(d) === todayStr);
  if (found) return found;
  // Fallback: return the first day that has lessons, or simply the first day
  return dates.length > 0 ? dates[0] : new Date();
}

// Find nearest upcoming study day or today across the whole academic year list of days
function findDefaultStudyDate(dates: Date[]): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Try today
  const todayStr = formatDateStr(today);
  const todayFound = dates.find((d) => formatDateStr(d) === todayStr);
  if (todayFound) return todayFound;

  // 2. Try nearest future date
  const futureDates = dates.filter((d) => d >= today);
  if (futureDates.length > 0) return futureDates[0];

  // 3. Fallback to first day
  return dates.length > 0 ? dates[0] : new Date();
}

// Resolve the current/nearest academic week range based on current date
function findCurrentWeekRange(weeks: Option[], today: Date): string {
  for (const wk of weeks) {
    const match = wk.value.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
    if (match) {
      const d1 = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
      const d2 = new Date(parseInt(match[6]), parseInt(match[5]) - 1, parseInt(match[4]));
      d1.setHours(0, 0, 0, 0);
      d2.setHours(23, 59, 59, 999);
      if (today >= d1 && today <= d2) {
        return wk.value;
      }
    }
  }
  // Alternately return the latest week available
  return weeks.length > 0 ? weeks[weeks.length - 1].value : "";
}

export default function App() {
  // Setup Wizard selections
  const [id_Forma, setIdForma] = useState<string>("");
  const [id_Fak, setIdFak] = useState<string>("");
  const [Kurs, setKurs] = useState<string>("");
  const [NamePodGrup, setNamePodGrup] = useState<string>("");
  const [RangeNedel, setRangeNedel] = useState<string>("");

  // Select Options loaded from Server
  const [formsList, setFormsList] = useState<Option[]>([]);
  const [facultiesList, setFacultiesList] = useState<Option[]>([]);
  const [coursesList, setCoursesList] = useState<Option[]>([]);
  const [groupsList, setGroupsList] = useState<Option[]>([]);
  const [weeksList, setWeeksList] = useState<Option[]>([]);

  // Main Loaded Schedule
  const [scheduleData, setScheduleData] = useState<ScheduleItem[]>([]);
  const [loadedWeeks, setLoadedWeeks] = useState<string[]>([]);

  // UI States
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isWizardMode, setIsWizardMode] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<"day" | "week">("day"); // 'day' timeline or full fortnight stacked list

  // Active clock state
  const [currentLocalTime, setCurrentLocalTime] = useState<string>("");

  useEffect(() => {
    const updateClock = () => {
      const daysRu = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
      const monthsRu = [
        "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря"
      ];
      const now = new Date();
      const dayName = daysRu[now.getDay()];
      const dayNum = now.getDate();
      const monthName = monthsRu[now.getMonth()];
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, "0");
      const mins = String(now.getMinutes()).padStart(2, "0");
      setCurrentLocalTime(`${dayName}, ${dayNum} ${monthName} ${year} • ${hours}:${mins}`);
    };
    updateClock();
    const timer = setInterval(updateClock, 10000);
    return () => clearInterval(timer);
  }, []);

  // --- STAGE Loading logic ---
  // On Mount: Detect saved group preferences or load initial Study Forms
  useEffect(() => {
    const saved = localStorage.getItem("sibupk_selected_schedule");
    if (saved) {
      try {
        const parsed: SavedPreferences = JSON.parse(saved);
        setIdForma(parsed.id_Forma);
        setIdFak(parsed.id_Fak);
        setKurs(parsed.Kurs);
        setNamePodGrup(parsed.NamePodGrup);
        setRangeNedel(parsed.RangeNedel);
        setIsWizardMode(false);
        
        // Fetch full schedule block immediately for this saved configuration
        fetchFullDataAndSchedule(parsed);
      } catch (err) {
        console.error("Failed to parse saved schedule, resetting.");
        localStorage.removeItem("sibupk_selected_schedule");
        loadFormOptions();
      }
    } else {
      loadFormOptions();
    }
  }, []);

  const loadFormOptions = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success && data.options?.forms) {
        setFormsList(data.options.forms);
      } else {
        throw new Error(data.error || "Не удалось загрузить формы обучения");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка подключения к серверу");
    } finally {
      setLoading(false);
    }
  };

  // Triggers when id_Forma changes (Loads Faculty options for that form)
  const handleFormChange = async (val: string) => {
    setIdForma(val);
    setIdFak("");
    setKurs("");
    setNamePodGrup("");
    setRangeNedel("");
    setFacultiesList([]);
    setCoursesList([]);
    setGroupsList([]);
    setWeeksList([]);

    if (!val) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_Forma: val }),
      });
      const data = await res.json();
      if (data.success && data.options?.faculties) {
        setFacultiesList(data.options.faculties);
      } else {
        throw new Error(data.error || "Не удалось загрузить факультеты");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка при получении факультетов");
    } finally {
      setLoading(false);
    }
  };

  // Triggers when id_Fak changes (Loads Courses options)
  const handleFakChange = async (val: string) => {
    setIdFak(val);
    setKurs("");
    setNamePodGrup("");
    setRangeNedel("");
    setCoursesList([]);
    setGroupsList([]);
    setWeeksList([]);

    if (!val) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_Forma, id_Fak: val }),
      });
      const data = await res.json();
      if (data.success && data.options?.courses) {
        setCoursesList(data.options.courses);
      } else {
        throw new Error(data.error || "Не удалось загрузить курсы");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка при получении курсов");
    } finally {
      setLoading(false);
    }
  };

  // Triggers when Kurs changes (Loads Groups options)
  const handleKursChange = async (val: string) => {
    setKurs(val);
    setNamePodGrup("");
    setRangeNedel("");
    setGroupsList([]);
    setWeeksList([]);

    if (!val) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_Forma, id_Fak, Kurs: val }),
      });
      const data = await res.json();
      if (data.success && data.options?.groups) {
        setGroupsList(data.options.groups);
      } else {
        throw new Error(data.error || "Не удалось загрузить группы");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка при получении групп");
    } finally {
      setLoading(false);
    }
  };

  // Triggers when Group is chosen: Load available weeks range, auto-resolve current week range, then POST back to load schedule
  const handleGroupSelectChange = async (val: string) => {
    setNamePodGrup(val);
    setRangeNedel("");
    setWeeksList([]);

    if (!val) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      // Step 1: Retreive weeks options for this group
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_Forma, id_Fak, Kurs, NamePodGrup: val }),
      });
      const data = await res.json();
      if (data.success && data.options?.weeks && data.options.weeks.length > 0) {
        const ws: Option[] = data.options.weeks;
        setWeeksList(ws);

        // Step 2: Auto-select which week contains today's local time
        const defaultWeek = findCurrentWeekRange(ws, new Date());
        setRangeNedel(defaultWeek);

        // Step 3: Call second fetch to load schedule immediately
        const resSched = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_Forma, id_Fak, Kurs, NamePodGrup: val, RangeNedel: defaultWeek }),
        });
        const dataSched = await resSched.json();

        if (dataSched.success && dataSched.schedule) {
          setScheduleData(dataSched.schedule);
          setLoadedWeeks([defaultWeek]);
          
          // Save preference to localStorage
          const pref: SavedPreferences = {
            id_Forma,
            id_Fak,
            Kurs,
            NamePodGrup: val,
            RangeNedel: defaultWeek,
            groupLabel: val
          };
          localStorage.setItem("sibupk_selected_schedule", JSON.stringify(pref));
          
          setIsWizardMode(false);
          
          // Compute all dates across the weeks we just got, and find default study date
          const allDates: Date[] = [];
          const dateStringsSeen = new Set<string>();
          ws.forEach((wk) => {
            const dates = generateRangeDates(wk.value);
            dates.forEach((d) => {
              const str = formatDateStr(d);
              if (!dateStringsSeen.has(str)) {
                dateStringsSeen.add(str);
                allDates.push(d);
              }
            });
          });
          allDates.sort((a, b) => a.getTime() - b.getTime());
          setSelectedDate(findDefaultStudyDate(allDates));
        } else {
          throw new Error("Не удалось загрузить таблицу расписания");
        }
      } else {
        throw new Error("Не найден список доступных недель для данной группы");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка при инициализации группы");
    } finally {
      setLoading(false);
    }
  };

  // Helper used when app boots up with previously saved state
  const fetchFullDataAndSchedule = async (pref: SavedPreferences) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      // Load current weeks & schedule
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_Forma: pref.id_Forma,
          id_Fak: pref.id_Fak,
          Kurs: pref.Kurs,
          NamePodGrup: pref.NamePodGrup,
          RangeNedel: pref.RangeNedel
        }),
      });
      const data = await res.json();
      if (data.success) {
        const ws = data.options?.weeks || [];
        setWeeksList(ws);
        setScheduleData(data.schedule || []);
        setLoadedWeeks([pref.RangeNedel]);
        
        const allDates: Date[] = [];
        const dateStringsSeen = new Set<string>();
        ws.forEach((wk: Option) => {
          const dates = generateRangeDates(wk.value);
          dates.forEach((d) => {
            const str = formatDateStr(d);
            if (!dateStringsSeen.has(str)) {
              dateStringsSeen.add(str);
              allDates.push(d);
            }
          });
        });
        allDates.sort((a, b) => a.getTime() - b.getTime());
        
        setSelectedDate(findDefaultStudyDate(allDates));
      } else {
        throw new Error(data.error || "Не удалось загрузить расписание");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка при подключении к сервису");
    } finally {
      setLoading(false);
    }
  };

  // Helper to discover which academic cycle/week contains the requested date
  const findWeekForDate = (date: Date): string | null => {
    for (const wk of weeksList) {
      const match = wk.value.match(/(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})/);
      if (match) {
        const d1 = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
        const d2 = new Date(parseInt(match[6]), parseInt(match[5]) - 1, parseInt(match[4]));
        d1.setHours(0, 0, 0, 0);
        d2.setHours(23, 59, 59, 999);
        if (date >= d1 && date <= d2) {
          return wk.value;
        }
      }
    }
    return null;
  };

  // Select month and query its first cycle if not loaded
  const handleMonthClick = (firstDate: Date) => {
    const parentWeek = findWeekForDate(firstDate);
    if (parentWeek) {
      ensureWeekLoaded(parentWeek, firstDate);
    } else {
      setSelectedDate(firstDate);
    }
  };

  // Loader used when clicking on days belonging to other week ranges dynamically
  const ensureWeekLoaded = async (weekVal: string, dateToSelect?: Date) => {
    if (!weekVal) return;
    
    if (loadedWeeks.includes(weekVal)) {
      if (dateToSelect) {
        setSelectedDate(dateToSelect);
      }
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_Forma,
          id_Fak,
          Kurs,
          NamePodGrup,
          RangeNedel: weekVal
        }),
      });
      const data = await res.json();
      if (data.success && data.schedule) {
        setScheduleData((prev) => {
          const merged = [...prev];
          const existingKeys = new Set(merged.map((item) => `${item.date}_${item.lessonNumber}_${item.subject}`));
          data.schedule.forEach((lesson: ScheduleItem) => {
            const key = `${lesson.date}_${lesson.lessonNumber}_${lesson.subject}`;
            if (!existingKeys.has(key)) {
              merged.push(lesson);
            }
          });
          return merged;
        });

        setLoadedWeeks((prev) => [...prev, weekVal]);
        setRangeNedel(weekVal);
        
        const saved = localStorage.getItem("sibupk_selected_schedule");
        if (saved) {
          const parsed = JSON.parse(saved);
          parsed.RangeNedel = weekVal;
          localStorage.setItem("sibupk_selected_schedule", JSON.stringify(parsed));
        }

        if (dateToSelect) {
          setSelectedDate(dateToSelect);
        }
      } else {
        throw new Error(data.error || "Не удалось загрузить расписание для выбранного диапазона");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Ошибка загрузки расписания цикла");
    } finally {
      setLoading(false);
    }
  };

  // Reset local state to launch the group selection wizard
  const resetGroupPreference = () => {
    localStorage.removeItem("sibupk_selected_schedule");
    setIdForma("");
    setIdFak("");
    setKurs("");
    setNamePodGrup("");
    setRangeNedel("");
    setScheduleData([]);
    setLoadedWeeks([]);
    setFacultiesList([]);
    setCoursesList([]);
    setGroupsList([]);
    setWeeksList([]);
    setIsWizardMode(true);
    setSelectedDate(null);
    loadFormOptions();
  };

  // Build the array of ALL Dates across all weeks
  const academicYearDates = useMemo(() => {
    if (weeksList.length === 0) return [];
    const allDates: Date[] = [];
    const dateStringsSeen = new Set<string>();
    weeksList.forEach((wk) => {
      const dates = generateRangeDates(wk.value);
      dates.forEach((d) => {
        const str = formatDateStr(d);
        if (!dateStringsSeen.has(str)) {
          dateStringsSeen.add(str);
          allDates.push(d);
        }
      });
    });
    return allDates.sort((a, b) => a.getTime() - b.getTime());
  }, [weeksList]);

  // Group academic dates by month for easy jumping
  const academicMonths = useMemo(() => {
    const list: { key: string; label: string; firstDate: Date }[] = [];
    const seen = new Set<string>();
    
    const monthNamesRu = [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];

    academicYearDates.forEach((date) => {
      const year = date.getFullYear();
      const monthIdx = date.getMonth();
      const key = `${year}-${monthIdx}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          key,
          label: `${monthNamesRu[monthIdx]} ${year}`,
          firstDate: date
        });
      }
    });

    return list;
  }, [academicYearDates]);

  // Find index of selected month/year in academicMonths array for paging
  const currentMonthIndex = useMemo(() => {
    if (!selectedDate || academicMonths.length === 0) return -1;
    const year = selectedDate.getFullYear();
    const monthIdx = selectedDate.getMonth();
    const key = `${year}-${monthIdx}`;
    return academicMonths.findIndex((m) => m.key === key);
  }, [selectedDate, academicMonths]);

  // Navigate to previous month in the academic list
  const handlePrevMonth = () => {
    if (currentMonthIndex > 0) {
      handleMonthClick(academicMonths[currentMonthIndex - 1].firstDate);
    }
  };

  // Navigate to next month in the academic list
  const handleNextMonth = () => {
    if (currentMonthIndex >= 0 && currentMonthIndex < academicMonths.length - 1) {
      handleMonthClick(academicMonths[currentMonthIndex + 1].firstDate);
    }
  };

  // Navigate directly to today's date in academic year
  const handleJumpToToday = () => {
    const today = new Date();
    const todayStr = formatDateStr(today);
    const foundDateInstance = academicYearDates.find((d) => formatDateStr(d) === todayStr);

    if (foundDateInstance) {
      const parentWeek = findWeekForDate(foundDateInstance);
      if (parentWeek) {
        ensureWeekLoaded(parentWeek, foundDateInstance);
      } else {
        setSelectedDate(foundDateInstance);
      }
    } else {
      // If today is not within the specific academic year dates parsed, default to nearest study date
      const nearest = findDefaultStudyDate(academicYearDates);
      const parentWeek = findWeekForDate(nearest);
      if (parentWeek) {
        ensureWeekLoaded(parentWeek, nearest);
      } else {
        setSelectedDate(nearest);
      }
    }
  };

  // Smooth scroll active calendar day icon into visibility
  useEffect(() => {
    if (selectedDate) {
      const activeStr = formatDateStr(selectedDate);
      const el = document.getElementById(`academic_day_btn_${activeStr}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [selectedDate, academicYearDates]);

  // Current active loaded week range (for "По неделям" or week layout display)
  const currentActiveWeekDates = useMemo(() => {
    if (!RangeNedel) return [];
    return generateRangeDates(RangeNedel);
  }, [RangeNedel]);

  // Sub-selector lessons for selected day
  const filteredTimelineLessons = useMemo(() => {
    if (!selectedDate) return [];
    const targetStr = formatDateStr(selectedDate);
    let lessons = scheduleData.filter((item) => item.date === targetStr);

    // Apply client filter query if present
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      lessons = lessons.filter(
        (l) =>
          l.subject.toLowerCase().includes(q) ||
          l.teacher.toLowerCase().includes(q) ||
          l.classroom.toLowerCase().includes(q)
      );
    }

    return lessons.sort((a, b) => a.lessonNumber - b.lessonNumber);
  }, [scheduleData, selectedDate, searchQuery]);

  // Compute stats: how many classes does each date have?
  const lessonCountsByDateMap = useMemo(() => {
    const counts: Record<string, number> = {};
    academicYearDates.forEach((d) => {
      const keystr = formatDateStr(d);
      counts[keystr] = scheduleData.filter((item) => item.date === keystr).length;
    });
    return counts;
  }, [academicYearDates, scheduleData]);

  // Helper: Return clean name of the week day
  const getDayShortRu = (dayName: string) => {
    const map: Record<string, string> = {
      "Понедельник": "Пн",
      "Вторник": "Вт",
      "Среда": "Ср",
      "Ччетверг": "Чт",
      "Четверг": "Чт",
      "Пятница": "Пт",
      "Суббота": "Сб",
      "Воскресенье": "Вс",
    };
    return map[dayName] || dayName.substring(0, 2);
  };

  // Helper: return month string
  const getMonthShortRu = (date: Date) => {
    const months = [
      "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
      "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"
    ];
    return months[date.getMonth()];
  };

  // Dynamic lesson badge generator based on category matching
  const getBadgeTypeStyles = (subject: string) => {
    const cleanSub = subject.toLowerCase();
    if (cleanSub.includes("(лек)") || cleanSub.includes("лекция")) {
      return {
        label: "Лекция",
        bg: "bg-blue-100 text-blue-800 border-blue-200",
        bullet: "bg-blue-700 font-bold"
      };
    }
    if (cleanSub.includes("(с)") || cleanSub.includes("семинар") || cleanSub.includes("(пр)") || cleanSub.includes("практ")) {
      return {
        label: "Семинар / Практика",
        bg: "bg-emerald-100 text-emerald-800 border-emerald-200",
        bullet: "bg-emerald-600 font-bold"
      };
    }
    if (cleanSub.includes("(зач)") || cleanSub.includes("зачет") || cleanSub.includes("(экз)") || cleanSub.includes("экзамен")) {
      return {
        label: "Зачет / Экзамен",
        bg: "bg-rose-100 text-rose-800 border-rose-250 animate-pulse",
        bullet: "bg-rose-600 font-bold"
      };
    }
    if (cleanSub.includes("проект") || cleanSub.includes("индивидуальный")) {
      return {
        label: "Проект",
        bg: "bg-indigo-100 text-indigo-800 border-indigo-200",
        bullet: "bg-indigo-600 font-bold"
      };
    }
    return {
      label: "Занятие",
      bg: "bg-gray-100 text-gray-700 border-gray-200",
      bullet: "bg-gray-500 font-semibold"
    };
  };

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900 flex flex-col font-sans transition-colors antialiased">
      {/* High Contrast Geometric Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200" id="main_header">
        <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Main branding */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-700 flex items-center justify-center rounded-none text-white border border-blue-800" id="logo_container">
              <span className="font-sans font-bold text-xl uppercase tracking-tighter">С</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight uppercase text-slate-950 flex items-center gap-2" id="title_main">
                СибУПК <span className="text-[9px] uppercase font-bold tracking-widest text-blue-700 bg-blue-50 px-2 py-0.5 border border-blue-200 rounded-none">Live</span>
              </h1>
              <p className="text-xs text-gray-400 font-bold tracking-widest uppercase flex items-center gap-1" id="clock_time">
                <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                {currentLocalTime || "ОБНОВЛЕНИЕ..."}
              </p>
            </div>
          </div>

          {/* User preferences display (State Toggle) */}
          {!isWizardMode && NamePodGrup && (
            <div className="flex items-center gap-3 self-start md:self-auto bg-gray-50 border border-gray-200 rounded-none p-2.5" id="saved_meta_panel">
              <div className="text-left">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Выбранная группа</p>
                <div className="text-xs font-bold text-slate-900 uppercase tracking-tight line-clamp-1 max-w-[200px]" title={NamePodGrup}>
                  {NamePodGrup}
                </div>
              </div>
              <button
                onClick={resetGroupPreference}
                className="ml-2 px-3 py-1.5 bg-white hover:bg-gray-100 text-blue-700 border border-gray-200 text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors rounded-none"
                id="reset_preference_btn"
              >
                Сменить
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Container Workspace */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6" id="app_workspace">
        
        {/* Error notification banner */}
        {errorMessage && (
          <div className="mb-6 bg-rose-50 border border-rose-100 rounded-xl p-4 text-sm text-rose-800 flex items-start gap-3 shadow-md shadow-rose-50" id="error_toast">
            <Info className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Произошла ошибка</p>
              <p className="opacity-90">{errorMessage}</p>
              <button
                onClick={() => {
                  setErrorMessage(null);
                  if (formsList.length === 0) loadFormOptions();
                }}
                className="mt-2 text-rose-700 bg-rose-100 hover:bg-rose-200 font-semibold px-3 py-1 rounded-lg text-xs cursor-pointer transition-all"
              >
                Повторить попытку
              </button>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* WIZARD SETUP FLOW */}
          {isWizardMode ? (
            <motion.div
              key="wizard_flow"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="bg-white border-2 border-slate-900 rounded-none shadow-none overflow-hidden"
              id="wizard_box"
            >
              {/* Wizard Header Banner */}
              <div className="bg-blue-700 p-6 md:p-8 text-white relative rounded-none">
                <div className="absolute right-6 top-6 opacity-5 pointer-events-none">
                  <Sparkles className="w-24 h-24" />
                </div>
                <div className="flex items-center gap-2 bg-white/10 border border-white/20 px-3 py-1 rounded-none text-[10px] font-bold uppercase tracking-widest w-max mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-blue-200" />
                  Информационная система
                </div>
                <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight">Добро пожаловать к расписанию СибУПК</h2>
                <p className="text-xs md:text-sm text-blue-100 mt-2 leading-relaxed font-medium uppercase tracking-wider opacity-90">
                  Укажите параметры обучения для быстрой синхронизации напрямую с ведомостями вуза.
                </p>
              </div>

              {/* Steps inputs holder */}
              <div className="p-6 md:p-8 space-y-6 bg-white" id="inputs_holder">
                
                {/* Step 1: Form of Education */}
                <div className="space-y-2" id="step_form_container">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3 block flex items-center gap-2">
                    <span className="w-5 h-5 rounded-none bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200 flex items-center justify-center">1</span>
                    Форма обучения
                  </label>
                  <div className="relative">
                    <select
                      value={id_Forma}
                      onChange={(e) => handleFormChange(e.target.value)}
                      disabled={loading || formsList.length === 0}
                      className="w-full p-3 border border-gray-200 bg-gray-50 text-slate-800 font-semibold rounded-none appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:bg-white text-sm outline-none transition-all"
                      id="select_forma"
                    >
                      <option value="">-- Выберите форму обучения --</option>
                      {formsList.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Step 2: Faculty */}
                {id_Forma && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-2"
                    id="step_faculty_container"
                  >
                    <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block flex items-center gap-2">
                      <span className="w-5 h-5 rounded-none bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200 flex items-center justify-center">2</span>
                      Факультет / Отделение
                    </label>
                    <select
                      value={id_Fak}
                      onChange={(e) => handleFakChange(e.target.value)}
                      disabled={loading || facultiesList.length === 0}
                      className="w-full p-3 border border-gray-200 bg-gray-50 text-slate-800 font-semibold rounded-none appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:bg-white text-sm outline-none transition-all"
                      id="select_fak"
                    >
                      <option value="">-- Выберите факультет --</option>
                      {facultiesList.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </motion.div>
                )}

                {/* Step 3: Course */}
                {id_Fak && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-2"
                    id="step_course_container"
                  >
                    <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block flex items-center gap-2">
                      <span className="w-5 h-5 rounded-none bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200 flex items-center justify-center">3</span>
                      Учебный курс
                    </label>
                    <select
                      value={Kurs}
                      onChange={(e) => handleKursChange(e.target.value)}
                      disabled={loading || coursesList.length === 0}
                      className="w-full p-3 border border-gray-200 bg-gray-50 text-slate-800 font-semibold rounded-none appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:bg-white text-sm outline-none transition-all"
                      id="select_kurs"
                    >
                      <option value="">-- Выберите курс --</option>
                      {coursesList.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </motion.div>
                )}

                {/* Step 4: Group / Subgroup */}
                {Kurs && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="space-y-2"
                    id="step_group_container"
                  >
                    <label className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block flex items-center gap-2">
                      <span className="w-5 h-5 rounded-none bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200 flex items-center justify-center">4</span>
                      Академическая группа
                    </label>
                    <select
                      value={NamePodGrup}
                      onChange={(e) => handleGroupSelectChange(e.target.value)}
                      disabled={loading || groupsList.length === 0}
                      className="w-full p-3 border border-gray-200 bg-gray-50 text-slate-800 font-semibold rounded-none appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-700/20 focus:bg-white text-sm outline-none transition-all"
                      id="select_group"
                    >
                      <option value="">-- Выберите группу --</option>
                      {groupsList.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                  </motion.div>
                )}

                {/* Loading status overlay */}
                {loading && (
                  <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-none p-4 text-xs text-gray-500 uppercase tracking-widest font-bold" id="loading_overlay">
                    <div className="w-4 h-4 border-2 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
                    <span className="animate-pulse">Обращение к служебному серверу СибУПК... Ожидайте</span>
                  </div>
                )}
              </div>

              {/* Static Disclaimer */}
              <div className="bg-gray-50 border-t border-gray-200 p-5 flex items-start gap-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-relaxed">
                <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                <p>
                  Веб-приложение осуществляет проксирование и анализ официальных файлов расписания. Копия данных вуза СибУПК (old.sibupk.su).
                </p>
              </div>
            </motion.div>
          ) : (
            
            /* TIMELINE VIEW STAGE (SCHEDULE ACTIVE) */
            <motion.div
              key="timeline_lessons_full"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              
              {/* TOP INTERACTIVE CONTROL PANEL (Search + toggle, no period selector) */}
              <div className="bg-white border border-gray-200 p-5 rounded-none shadow-none space-y-4" id="controls_panel">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-850">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-blue-700 shrink-0" />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-705">Учебный год</span>
                  </div>

                  {/* View mode toggle button */}
                  <div className="flex items-center gap-1.5 w-full sm:w-auto" id="toggle_view_modes">
                    <button
                      onClick={() => setViewMode("day")}
                      className={`flex-1 sm:flex-none px-4 py-2 border-2 text-xs font-bold uppercase tracking-tight transition-all rounded-none text-center ${
                        viewMode === "day"
                          ? "border-blue-700 bg-blue-700 text-white"
                          : "border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                      }`}
                      id="btn_view_day"
                    >
                      По дням
                    </button>
                    <button
                      onClick={() => setViewMode("week")}
                      className={`flex-1 sm:flex-none px-4 py-2 border-2 text-xs font-bold uppercase tracking-tight transition-all rounded-none text-center ${
                        viewMode === "week"
                          ? "border-blue-700 bg-blue-700 text-white"
                          : "border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                      }`}
                      id="btn_view_week"
                    >
                      По неделям
                    </button>
                    <button
                      type="button"
                      onClick={handleJumpToToday}
                      className="flex-1 sm:flex-none px-4 py-2 border-2 text-xs font-black uppercase tracking-tight transition-all rounded-none text-center border-transparent bg-blue-50 text-blue-750 hover:bg-blue-100 hover:text-slate-900 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                      id="btn_jump_to_today"
                    >
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      Сегодня
                    </button>
                  </div>
                </div>

                {/* Interactive Instant Filter Search bar */}
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Быстрый фильтр: математика, преподаватель или аудитория..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full text-xs md:text-sm bg-gray-50 border border-gray-200 hover:border-gray-300 focus:bg-white focus:border-blue-700 rounded-none pl-10 pr-4 py-3 outline-none transition-all"
                    id="filter_classes_input"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 hover:text-blue-700 cursor-pointer uppercase tracking-wider"
                    >
                      Очистить
                    </button>
                  )}
                </div>
              </div>

              {/* DYNAMIC CALENDAR NAVIGATION & STRIP (Horizontal Swiper for Academic Year) */}
              {viewMode === "day" && academicYearDates.length > 0 && (
                <div className="space-y-4 bg-white border border-gray-200 p-5 rounded-none shadow-none" id="month_calendar_block">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1 flex items-center gap-1.5 select-none">
                      <Calendar className="w-3.5 h-3.5 text-blue-700" />
                      Выбор учебного месяца
                    </h3>
                  </div>

                  {/* Interactive Month Switcher Layout with Left & Right controls */}
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 p-2 text-slate-900 rounded-none select-none">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      disabled={currentMonthIndex <= 0}
                      className={`p-2 border transition-all flex items-center justify-center rounded-none select-none ${
                        currentMonthIndex <= 0
                          ? "opacity-35 cursor-not-allowed border-gray-200 text-gray-300 bg-gray-50"
                          : "border-gray-200 hover:border-slate-800 hover:bg-slate-800 hover:text-white text-slate-700 bg-white cursor-pointer active:scale-95"
                      }`}
                      title="Предыдущий месяц"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    
                    <div className="text-center font-bold">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5 leading-none">Выбранный месяц</div>
                      <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-900 leading-normal">
                        {currentMonthIndex >= 0 ? academicMonths[currentMonthIndex].label : "Не выбран"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleNextMonth}
                      disabled={currentMonthIndex === -1 || currentMonthIndex >= academicMonths.length - 1}
                      className={`p-2 border transition-all flex items-center justify-center rounded-none select-none ${
                        currentMonthIndex === -1 || currentMonthIndex >= academicMonths.length - 1
                          ? "opacity-35 cursor-not-allowed border-gray-200 text-gray-300 bg-gray-50"
                          : "border-gray-200 hover:border-slate-800 hover:bg-slate-800 hover:text-white text-slate-700 bg-white cursor-pointer active:scale-95"
                      }`}
                      title="Следующий месяц"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Complete Academic Months Quick Selection Grid */}
                  {academicMonths.length > 0 && (
                    <div className="space-y-2 mt-2" id="academic_months_nav">
                      <div className="text-[10px] font-black tracking-widest text-gray-400 uppercase px-1">Быстрый переход</div>
                      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {academicMonths.map((m, idx) => {
                          const isMonthActive = currentMonthIndex === idx;
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => handleMonthClick(m.firstDate)}
                              className={`px-2.5 py-2 text-[10px] font-black uppercase tracking-wider text-center border cursor-pointer select-none transition-all ${
                                isMonthActive
                                  ? "bg-slate-950 border-slate-950 text-white font-black"
                                  : "bg-white border-gray-200 text-gray-500 hover:text-slate-900 hover:border-gray-400 hover:bg-gray-50"
                              }`}
                            >
                              {m.label.split(" ")[0]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-gray-100 pt-3 mt-3">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Выберите день учебного года</h3>
                  </div>
                  
                  <div className="flex gap-2 overflow-x-auto py-1 px-1 no-scrollbar scroll-smooth" id="dates_swiper">
                    {academicYearDates.map((dateObj, idx) => {
                      const str = formatDateStr(dateObj);
                      const isSelected = selectedDate && formatDateStr(selectedDate) === str;
                      const isToday = formatDateStr(new Date()) === str;
                      
                      const dayName = dateObj.toLocaleDateString("ru-RU", { weekday: "long" });
                      const formattedDayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);
                      const dayShort = getDayShortRu(formattedDayName);
                      
                      const dayNum = dateObj.getDate();
                      const monthShort = getMonthShortRu(dateObj);
                      const lessonsCount = lessonCountsByDateMap[str] || 0;

                      // Is Sunday?
                      const isSunday = dateObj.getDay() === 0;

                      return (
                        <button
                          key={str}
                          id={`academic_day_btn_${str}`}
                          onClick={() => {
                            const parentWeek = findWeekForDate(dateObj);
                            if (parentWeek) {
                              ensureWeekLoaded(parentWeek, dateObj);
                            } else {
                              setSelectedDate(dateObj);
                            }
                            setErrorMessage(null);
                          }}
                          className={`flex-none w-14 rounded-none py-2.5 flex flex-col items-center justify-center border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-blue-700 border-2 border-blue-700 text-white scale-100 "
                              : isToday
                                ? "bg-blue-50/70 border-2 border-dashed border-blue-600 text-blue-900 font-extrabold"
                                : "bg-white border-gray-200 hover:bg-blue-50/20 text-slate-800"
                          }`}
                        >
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${isSelected ? "text-blue-200" : isSunday ? "text-rose-500" : "text-gray-400"}`}>
                            {dayShort}
                          </span>
                          <span className="text-md font-black tracking-tighter mt-0.5">{dayNum}</span>
                          <span className={`text-[9px] uppercase font-bold tracking-widest ${isSelected ? "text-blue-100" : "text-gray-400"}`}>
                            {monthShort}
                          </span>

                          {/* Class list indicator dot */}
                          {lessonsCount > 0 && (
                            <span className={`w-1.5 h-1.5 rounded-none mt-1.5 ${isSelected ? "bg-white" : "bg-blue-700"}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SCREEN LOADER SKELETON WITH TRANSITION */}
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 bg-white border border-gray-200 rounded-none space-y-4 shadow-none" id="timeline_loading">
                  <div className="w-10 h-10 border-3 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
                  <div className="text-center space-y-2">
                    <p className="text-xs font-bold text-slate-900 uppercase tracking-widest animate-pulse">Запрос в ведомственную базу данных...</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Загружаем список учебных пар...</p>
                  </div>
                </div>
              ) : (
                
                /* TIMELINE / WEEKLY VIEW CONTENT */
                <AnimatePresence mode="wait">
                  {viewMode === "day" ? (
                    
                    /* DAY TIMELINE LAYOUT */
                    <motion.div
                       key="day_timeline_lessons"
                       initial={{ opacity: 0 }}
                       animate={{ opacity: 1 }}
                       exit={{ opacity: 0 }}
                       className="space-y-4"
                    >
                      {/* Active Day Meta Summary header */}
                      {selectedDate && (
                        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b-2 border-slate-900 pb-4 px-0.5" id="timeline_header_block">
                          <div>
                            <h3 className="text-md md:text-xl font-black uppercase tracking-tight text-slate-900" id="current_date_subtitle">
                              {selectedDate.toLocaleDateString("ru-RU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                            </h3>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                              Распределение занятий: <span className="font-extrabold text-blue-700">{filteredTimelineLessons.length} пар</span>
                            </p>
                          </div>
                          
                          {/* Indicator which academic loop week is this (Odd or Even) */}
                          {filteredTimelineLessons.length > 0 && (
                            <span className="text-[10px] uppercase font-bold tracking-widest bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1 rounded-none">
                              {filteredTimelineLessons[0].weekType || "Учебный цикл"}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Main lessons stack */}
                      {filteredTimelineLessons.length > 0 ? (
                        <div className="relative pl-4 space-y-6 before:absolute before:left-7 before:top-4 before:bottom-4 before:w-0.5 before:bg-gray-200" id="timeline_lessons_scroller">
                          {filteredTimelineLessons.map((lesson, idx) => {
                            const badge = getBadgeTypeStyles(lesson.subject);
                            return (
                              <motion.div
                                key={idx}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.15, delay: idx * 0.05 }}
                                className="relative flex flex-col md:flex-row gap-4 items-start"
                                id={`timeline_lesson_item_${idx}`}
                              >
                                {/* Sharp square counter pin in vertical axis */}
                                <div className="absolute left-1.5 top-2.5 w-4 h-4 rounded-none border-2 border-slate-900 bg-white flex items-center justify-center z-10">
                                  <span className={`w-1.5 h-1.5 rounded-none ${badge.bullet}`} />
                                </div>

                                {/* Lesson Number & Time block */}
                                <div className="ml-8 md:ml-10 md:w-28 shrink-0 pt-0.5">
                                  <span className="font-sans text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Пара {lesson.lessonNumber}</span>
                                  <span className="text-sm font-bold font-mono text-blue-700 flex items-center gap-1 mt-0.5">
                                    <Clock className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                                    {lesson.time || "Нет времени"}
                                  </span>
                                </div>

                                {/* Main Class Info card */}
                                <div className="flex-1 w-full bg-white border border-gray-200 p-5 rounded-none hover:bg-blue-50/20 transition-all">
                                  <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border ${badge.bg}`}>
                                      {badge.label}
                                    </span>
                                    {lesson.classroom && (
                                      <span className="text-[9px] font-bold bg-gray-100 text-gray-605 border border-gray-200 px-2 py-0.5 rounded-none flex items-center gap-1 uppercase tracking-wide">
                                        <MapPin className="w-2.5 h-2.5 text-gray-500" />
                                        Ауд. {lesson.classroom}
                                      </span>
                                    )}
                                  </div>

                                  <h4 className="text-sm md:text-base font-bold text-slate-900 leading-tight uppercase tracking-tight">
                                    {lesson.subject}
                                  </h4>

                                  {/* Teacher & Stream flows */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-150 text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    {lesson.teacher && (
                                      <div className="flex items-center gap-1.5" title="Преподаватель">
                                        <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                        <span className="truncate">{lesson.teacher}</span>
                                      </div>
                                    )}
                                    {lesson.stream && (
                                      <div className="flex items-center gap-1.5 text-[10px]" title="Поток">
                                        <Layers className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                        <span className="truncate text-gray-400">Поток: {lesson.stream}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      ) : (
                        
                        /* EMPTY STATE - NO CLASSES FOR ACTIVE DATE */
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex flex-col items-center justify-center py-16 px-6 bg-white border border-gray-200 rounded-none text-center shadow-none space-y-4"
                          id="empty_lessons_day"
                        >
                          <div className="w-16 h-16 bg-blue-50 text-blue-700 rounded-none flex items-center justify-center border-2 border-blue-700">
                            <Sparkles className="w-8 h-8" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-base font-bold uppercase tracking-wide text-slate-900">Свободный день!</h4>
                            <p className="text-xs text-gray-500 uppercase tracking-widest max-w-sm">
                              {searchQuery ? "По вашему поисковому запросу занятий не найдено" : "На этот день в ведомости СибУПК нет назначенных пар."}
                            </p>
                          </div>
                          {searchQuery && (
                            <button
                              onClick={() => setSearchQuery("")}
                              className="text-xs bg-blue-50 hover:bg-blue-100 border border-blue-250 text-blue-700 font-bold px-4 py-2 rounded-none cursor-pointer uppercase tracking-wider transition-colors"
                            >
                              Сбросить фильтр поиска
                            </button>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  ) : (
                    
                    /* FULL FORTNIGHT STACKED VIEW mapped across currentActiveWeekDates */
                    <motion.div
                      key="full_week_lessons"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-6"
                      id="full_week_stack"
                    >
                      {currentActiveWeekDates.map((dateObj, dIdx) => {
                        const str = formatDateStr(dateObj);
                        
                        // Parse list of lessons
                        let lessonsForDay = scheduleData.filter((item) => item.date === str);
                        if (searchQuery.trim()) {
                          const q = searchQuery.toLowerCase();
                          lessonsForDay = lessonsForDay.filter(
                            (l) =>
                              l.subject.toLowerCase().includes(q) ||
                              l.teacher.toLowerCase().includes(q) ||
                              l.classroom.toLowerCase().includes(q)
                          );
                        }

                        // Skip empty days in full list only if user is actively searching to clean up view
                        if (searchQuery.trim() && lessonsForDay.length === 0) return null;

                        const dayName = dateObj.toLocaleDateString("ru-RU", { weekday: "long" });
                        const formattedDayName = dayName.charAt(0).toUpperCase() + dayName.slice(1);
                        const isSunday = dateObj.getDay() === 0;

                        return (
                          <div key={dIdx} className="bg-white border border-gray-200 rounded-none p-5 shadow-none" id={`full_week_day_${dIdx}`}>
                            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3 mb-3">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-extrabold uppercase tracking-widest ${isSunday ? "text-rose-600" : "text-blue-700"}`}>
                                  {formattedDayName}
                                </span>
                                <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">({str})</span>
                              </div>
                              <span className="text-[10px] bg-gray-100 text-gray-650 border border-gray-200 px-2.5 py-0.5 rounded-none font-bold uppercase tracking-wider">
                                {lessonsForDay.length} пар
                              </span>
                            </div>

                            {lessonsForDay.length > 0 ? (
                              <div className="space-y-3" id={`lessons_list_day_${dIdx}`}>
                                {lessonsForDay.map((lesson, idx) => {
                                  const badge = getBadgeTypeStyles(lesson.subject);
                                  return (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-blue-50/20 rounded-none border border-gray-200 transition-all text-xs"
                                    >
                                      {/* Index/Time Block */}
                                      <div className="w-20 shrink-0 border-r border-gray-200 pr-2">
                                        <span className="font-bold text-slate-800 font-mono text-[11px] uppercase block">Пара {lesson.lessonNumber}</span>
                                        <span className="text-[10px] text-gray-400 block font-mono mt-0.5">{lesson.time}</span>
                                      </div>

                                      {/* Core details */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 border ${badge.bg}`}>
                                            {badge.label}
                                          </span>
                                          {lesson.classroom && (
                                            <span className="text-[9px] font-bold text-gray-500 uppercase flex items-center gap-0.5">
                                              <MapPin className="w-2.5 h-2.5" />
                                              Ауд. {lesson.classroom}
                                            </span>
                                          )}
                                        </div>
                                        <h5 className="font-bold text-slate-900 uppercase tracking-tight truncate leading-tight">
                                          {lesson.subject}
                                        </h5>
                                        {lesson.teacher && (
                                          <p className="text-[10px] text-gray-400 mt-0.5 truncate flex items-center gap-1 select-none font-medium uppercase tracking-wider">
                                            <User className="w-3 h-3 text-gray-300 shrink-0" />
                                            {lesson.teacher}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-450 uppercase font-bold tracking-widest text-center py-2 select-none">
                                Занятий нет • Выходной день
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Structured Minimal & Geometric Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12 py-8 text-center text-xs text-gray-500 space-y-3">
        {/* Dynamic Horizontal Legend */}
        <div className="max-w-md mx-auto flex flex-wrap gap-4 items-center justify-center text-[10px] font-bold text-gray-400 uppercase tracking-widest py-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-blue-100 border border-blue-200"></div>
            <span>Лекция</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-emerald-100 border border-emerald-200"></div>
            <span>Практика</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 bg-rose-100 border border-rose-200"></div>
            <span>Зачет / Экзамен</span>
          </div>
        </div>
        
        <p className="font-bold uppercase tracking-wider text-slate-800 text-[10px]">Система просмотра расписания Сибирского Университета Потребительской Кооперации (СибУПК)</p>
        <div className="max-w-md mx-auto px-4 flex items-center justify-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-gray-400">
          <CheckCircle className="w-3.5 h-3.5 text-blue-700 shrink-0" />
          <span>Синхронизация с системой вуза выполнена</span>
        </div>
      </footer>
    </div>
  );
}
