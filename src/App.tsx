import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Shell } from './components/Shell';
import { getSettings } from './db/db';
import { startReminderLoop } from './lib/notifications';

// Cada pantalla vive en src/features/<área>/<Pantalla>.tsx con export default.
const Hoy = lazy(() => import('./features/home/Hoy'));
const Atrasadas = lazy(() => import('./features/tasks/Atrasadas'));
const TaskForm = lazy(() => import('./features/tasks/TaskForm'));
const TaskDetail = lazy(() => import('./features/tasks/TaskDetail'));
const Avisos = lazy(() => import('./features/tasks/Avisos'));
const Calendario = lazy(() => import('./features/calendar/Calendario'));
const Dia = lazy(() => import('./features/calendar/Dia'));
const Estudio = lazy(() => import('./features/study/Estudio'));
const ExamForm = lazy(() => import('./features/study/ExamForm'));
const ExamDetail = lazy(() => import('./features/study/ExamDetail'));
const StudyPlan = lazy(() => import('./features/study/StudyPlan'));
const WorkDetail = lazy(() => import('./features/study/WorkDetail'));
const PdfView = lazy(() => import('./features/files/PdfView'));
const Resumen = lazy(() => import('./features/summary/Resumen'));
const Ajustes = lazy(() => import('./features/settings/Ajustes'));
const Asignaturas = lazy(() => import('./features/settings/Asignaturas'));
const Bienvenida = lazy(() => import('./features/settings/Bienvenida'));

function FirstRun() {
  const nav = useNavigate();
  useEffect(() => {
    getSettings().then((s) => {
      if (!s.onboarded && !location.hash.includes('bienvenida')) nav('/bienvenida', { replace: true });
    });
    return startReminderLoop();
  }, [nav]);
  return null;
}

export default function App() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <FirstRun />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/bienvenida" element={<Bienvenida />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Hoy />} />
            <Route path="/atrasadas" element={<Atrasadas />} />
            <Route path="/tarea/nueva" element={<TaskForm />} />
            <Route path="/tarea/:id" element={<TaskDetail />} />
            <Route path="/tarea/:id/editar" element={<TaskForm />} />
            <Route path="/calendario" element={<Calendario />} />
            <Route path="/dia/:date" element={<Dia />} />
            <Route path="/estudio" element={<Estudio />} />
            <Route path="/examen/nuevo" element={<ExamForm />} />
            <Route path="/examen/:id" element={<ExamDetail />} />
            <Route path="/examen/:id/editar" element={<ExamForm />} />
            <Route path="/examen/:id/plan" element={<StudyPlan />} />
            <Route path="/trabajo/:id" element={<WorkDetail />} />
            <Route path="/adjunto/:id" element={<PdfView />} />
            <Route path="/resumen" element={<Resumen />} />
            <Route path="/ajustes" element={<Ajustes />} />
            <Route path="/ajustes/asignaturas" element={<Asignaturas />} />
            <Route path="/ajustes/avisos" element={<Avisos />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
