import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, updateSettings } from '../../db/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings, useSubjects } from '../../db/hooks';
import { clearAllData, loadDemoData } from '../../db/seed';
import { todayISO } from '../../lib/dates';
import { CellLink, ConfirmSheet, NavBar, Segmented, Sheet, Switch, useToast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { downloadBlob } from '../files/fileUtils';
import { countsOf, exportBackup, readBackup, restoreBackup, type Backup } from './backup';
import './settings.css';
import { APP_VERSION, checkForUpdate } from '../../lib/update';

const DURATIONS = [15, 30, 45, 60, 90];

export default function Ajustes() {
  const account = useLiveQuery(async () => (await db.meta.get('sync.user'))?.value as string | undefined, []);
  const settings = useSettings();
  const subjects = useSubjects();
  const [checking, setChecking] = useState(false);
  const onCheckUpdate = async () => {
    setChecking(true);
    try {
      const r = await checkForUpdate();
      toast.show({ text: r === 'updating' ? 'Actualizando…' : r === 'latest' ? `Ya tienes la última versión (${APP_VERSION})` : 'No se pudo comprobar. Cierra y vuelve a abrir la app.' });
    } catch {
      toast.show({ text: 'Sin conexión. Inténtalo más tarde.' });
    } finally {
      setChecking(false);
    }
  };
  const toast = useToast();
  const importRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [pending, setPending] = useState<Backup | null>(null);
  const [confirm, setConfirm] = useState<'demo' | 'clear' | null>(null);
  const [clearText, setClearText] = useState('');

  const reminderCount = settings.defaultReminders.examen.length;

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `scheura-copia-${todayISO()}.json`);
      toast.show({ text: 'Copia exportada' });
    } catch {
      toast.show({ text: 'No se pudo exportar la copia' });
    } finally {
      setExporting(false);
    }
  };

  const onImportFile = async (file?: File) => {
    if (!file) return;
    try {
      setPending(await readBackup(file));
    } catch (e) {
      toast.show({ text: e instanceof Error ? e.message : 'No se pudo leer la copia' });
    }
  };

  const doRestore = async () => {
    if (!pending) return;
    try {
      await restoreBackup(pending);
      toast.show({ text: 'Copia restaurada' });
    } catch {
      toast.show({ text: 'No se pudo restaurar la copia' });
    }
    setPending(null);
  };

  const pendingCounts = pending ? countsOf(pending) : null;

  return (
    <div className="settings-bg">
      <main className="page page--pushed settings-page">
        <NavBar back="Hoy" backTo="/" title="Ajustes" />

        <h2 className="group__label">Cuenta</h2>
        <div className="group">
          <CellLink to="/ajustes/sincronizar" label={account ? 'Conectado como' : 'Iniciar sesión'}
            value={account ?? 'Usuario y contraseña'} />
        </div>

        <h2 className="group__label">Organización</h2>
        <div className="group">
          <CellLink to="/ajustes/asignaturas" label="Asignaturas" value={subjects.length} />
          <CellLink to="/ajustes/avisos" label="Recordatorios" value={`${reminderCount} por defecto`} />
        </div>

        <h2 className="group__label">Calendario y día</h2>
        <div className="group">
          <div className="cell">
            <span className="cell__label" id="lbl-week">Inicio de semana</span>
            <div className="cell__seg">
              <Segmented
                label="Inicio de semana"
                value={String(settings.weekStart) as '0' | '1'}
                onChange={(v) => updateSettings({ weekStart: v === '0' ? 0 : 1 })}
                options={[{ value: '1', label: 'Lunes' }, { value: '0', label: 'Domingo' }]}
              />
            </div>
          </div>
          <div className="cell cell--stack">
            <span className="cell__label">Vista por defecto del calendario</span>
            <Segmented
              label="Vista por defecto del calendario"
              value={settings.calendarView}
              onChange={(v) => updateSettings({ calendarView: v })}
              options={[{ value: 'mes', label: 'Mes' }, { value: 'semana', label: 'Semana' }]}
            />
          </div>
          <div className="cell cell--stack">
            <span className="cell__label">Ordenar el día por</span>
            <Segmented
              label="Ordenar el día por"
              value={settings.daySort}
              onChange={(v) => updateSettings({ daySort: v })}
              options={[{ value: 'hora', label: 'Hora' }, { value: 'importancia', label: 'Importancia' }]}
            />
          </div>
          <label className="cell">
            <span className="cell__label">Duración por defecto</span>
            <select value={settings.defaultDuration} onChange={(e) => updateSettings({ defaultDuration: Number(e.target.value) })}>
              {(DURATIONS.includes(settings.defaultDuration) ? DURATIONS : [...DURATIONS, settings.defaultDuration].sort((a, b) => a - b)).map((d) => (
                <option key={d} value={d}>{d < 60 ? `${d} min` : d === 60 ? '1 h' : `${Math.floor(d / 60)} h ${d % 60} min`}</option>
              ))}
            </select>
          </label>
          <div className="cell">
            <span className="cell__label">Ocultar tareas hechas</span>
            <Switch label="Ocultar tareas hechas" checked={settings.hideDone} onChange={(v) => updateSettings({ hideDone: v })} />
          </div>
          <div className="cell">
            <span className="cell__label">Resumen semanal el domingo</span>
            <Switch label="Resumen semanal el domingo" checked={settings.weeklySummary} onChange={(v) => updateSettings({ weeklySummary: v })} />
          </div>
        </div>

        <h2 className="group__label">Datos</h2>
        <div className="group">
          <button type="button" className="cell" onClick={doExport} disabled={exporting}>
            <Icon name="download" size={20} />
            <span className="cell__label">Exportar copia (.json)</span>
            {exporting && <span className="cell__value small">Preparando…</span>}
          </button>
          <button type="button" className="cell" onClick={() => importRef.current?.click()}>
            <Icon name="upload" size={20} />
            <span className="cell__label">Importar copia</span>
          </button>
          <button type="button" className="cell" onClick={() => setConfirm('demo')}>
            <Icon name="book" size={20} />
            <span className="cell__label">Cargar datos de ejemplo</span>
          </button>
          <button type="button" className="cell cell--danger" onClick={() => setConfirm('clear')}>
            <Icon name="trash" size={20} />
            <span className="cell__label">Borrar todos los datos</span>
          </button>
        </div>
        <p className="group__foot">Tus datos se guardan solo en este dispositivo. Haz copias de vez en cuando.</p>
        <input
          ref={importRef}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            void onImportFile(f);
          }}
        />

        <div className="group settings-about">
          <CellLink to="/bienvenida" label="Instalar app" value="Pantalla de inicio" />
          <button type="button" className="cell" onClick={onCheckUpdate} disabled={checking}>
            <span className="cell__label">Buscar actualizaciones</span>
            <span className="cell__value">{checking ? 'Buscando…' : ''}</span>
          </button>
          <div className="cell">
            <span className="cell__label">Acerca de Scheura</span>
            <span className="cell__value">versión {APP_VERSION}</span>
          </div>
        </div>

        <div className="settings-wordmark">
          <Link to="/" aria-label="Ir a Hoy">scheura<span>.</span></Link>
        </div>
      </main>

      <ConfirmSheet
        open={!!pending}
        onClose={() => setPending(null)}
        title="¿Reemplazar tus datos?"
        message={pendingCounts ? `Se borrará todo lo que tienes ahora y se cargará la copia: ${pendingCounts.subjects} asignaturas, ${pendingCounts.tasks} tareas, ${pendingCounts.exams} exámenes y ${pendingCounts.attachments} archivos.` : undefined}
        confirmLabel="Reemplazar con la copia"
        onConfirm={doRestore}
      />
      <ConfirmSheet
        open={confirm === 'demo'}
        onClose={() => setConfirm(null)}
        title="¿Cargar datos de ejemplo?"
        message="Se añadirán asignaturas, tareas y exámenes de ejemplo a lo que ya tienes."
        confirmLabel="Cargar ejemplo"
        onConfirm={async () => {
          await loadDemoData();
          toast.show({ text: 'Datos de ejemplo cargados' });
        }}
      />
      <Sheet open={confirm === 'clear'} onClose={() => { setConfirm(null); setClearText(''); }} title="¿Borrar todos los datos?">
        <p className="muted small" style={{ marginTop: 0 }}>
          Se borrarán asignaturas, tareas, exámenes y archivos <strong>de este dispositivo</strong>. No se puede deshacer.
          {account ? ' Tus otros dispositivos y la copia sincronizada no se tocan.' : ' Si no tienes una copia exportada, los perderás para siempre.'}
        </p>
        <label className="stack" style={{ gap: 6 }}>
          <span className="small">Para confirmar, escribe <strong>BORRAR</strong></span>
          <input className="field" value={clearText} onChange={(e) => setClearText(e.target.value)} autoCapitalize="characters"
            autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="BORRAR" aria-label="Escribe BORRAR para confirmar" />
        </label>
        <div className="stack" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--block" style={{ color: '#fff', background: 'var(--danger)', borderColor: 'var(--danger)' }}
            disabled={clearText.trim().toUpperCase() !== 'BORRAR'}
            onClick={async () => {
              setConfirm(null);
              setClearText('');
              await clearAllData();
              toast.show({ text: 'Datos borrados de este dispositivo' });
            }}>
            Borrar todo
          </button>
          <button type="button" className="btn btn--block btn--ghost" onClick={() => { setConfirm(null); setClearText(''); }}>Cancelar</button>
        </div>
      </Sheet>
      {toast.node}
    </div>
  );
}
