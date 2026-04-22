import React, { useState, useEffect } from 'react';
import { Briefcase, Users, Upload, FileText, CheckCircle2, XCircle, Clock, ArrowLeft, Plus, Send, Loader2, Sparkles, TrendingUp, AlertCircle, ChevronRight, User, Building2, ClipboardCheck, MessageSquare, Award, Target, X } from 'lucide-react';

export default function HiringAssistant() {
  const [view, setView] = useState('recruiter');
  const [page, setPage] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const jobsResult = await window.storage.get('jobs');
      const candidatesResult = await window.storage.get('candidates');
      if (jobsResult) setJobs(JSON.parse(jobsResult.value));
      if (candidatesResult) setCandidates(JSON.parse(candidatesResult.value));
    } catch (e) {}
    setLoading(false);
  };

  const saveJobs = async (newJobs) => {
    setJobs(newJobs);
    try { await window.storage.set('jobs', JSON.stringify(newJobs)); } catch (e) { console.error(e); }
  };

  const saveCandidates = async (newCandidates) => {
    setCandidates(newCandidates);
    try { await window.storage.set('candidates', JSON.stringify(newCandidates)); } catch (e) { console.error(e); }
  };

  const callClaude = async (prompt, systemPrompt = null) => {
    const messages = [{ role: 'user', content: prompt }];
    const body = { max_tokens: 2000, messages };
    if (systemPrompt) body.system = systemPrompt;

    const response = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'API request failed');
    }
    const data = await response.json();
    return data.content.map(c => c.text || '').join('\n');
  };

  const parseJSON = (text) => {
    const clean = text.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : clean);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-slate-900">Hiring Assistant</h1>
              <p className="text-xs text-slate-500">AI-powered candidate evaluation</p>
            </div>
          </div>
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => { setView('recruiter'); setPage('jobs'); }}
              className={\`px-4 py-1.5 text-sm font-medium rounded-md transition-colors \${view === 'recruiter' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}\`}
            >
              <Building2 className="w-4 h-4 inline mr-1.5" />
              Recruiter
            </button>
            <button
              onClick={() => { setView('candidate'); setPage('select'); }}
              className={\`px-4 py-1.5 text-sm font-medium rounded-md transition-colors \${view === 'candidate' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}\`}
            >
              <User className="w-4 h-4 inline mr-1.5" />
              Candidate
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-sm text-red-900">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {view === 'recruiter' && (
          <RecruiterView
            page={page} setPage={setPage}
            jobs={jobs} saveJobs={saveJobs}
            candidates={candidates} saveCandidates={saveCandidates}
            selectedJob={selectedJob} setSelectedJob={setSelectedJob}
            selectedCandidate={selectedCandidate} setSelectedCandidate={setSelectedCandidate}
            processing={processing} setProcessing={setProcessing}
            callClaude={callClaude} parseJSON={parseJSON}
            setError={setError}
          />
        )}

        {view === 'candidate' && (
          <CandidateView
            page={page} setPage={setPage}
            jobs={jobs} candidates={candidates} saveCandidates={saveCandidates}
            selectedJob={selectedJob} setSelectedJob={setSelectedJob}
            selectedCandidate={selectedCandidate} setSelectedCandidate={setSelectedCandidate}
            processing={processing} setProcessing={setProcessing}
            callClaude={callClaude} parseJSON={parseJSON}
            setError={setError}
          />
        )}
      </main>
    </div>
  );
}

function RecruiterView({ page, setPage, jobs, saveJobs, candidates, saveCandidates, selectedJob, setSelectedJob, selectedCandidate, setSelectedCandidate, processing, setProcessing, callClaude, parseJSON, setError }) {
  if (page === 'jobs') return <JobsList jobs={jobs} candidates={candidates} onOpen={(j) => { setSelectedJob(j); setPage('jobDetail'); }} onNew={() => setPage('newJob')} />;
  if (page === 'newJob') return <NewJob onCancel={() => setPage('jobs')} onCreate={async (job) => { await saveJobs([...jobs, job]); setPage('jobs'); }} />;
  if (page === 'jobDetail') return <JobDetail job={selectedJob} candidates={candidates.filter(c => c.jobId === selectedJob.id)} onBack={() => setPage('jobs')} onUpload={async (resumeText, fileName) => {
    setProcessing(true);
    setError(null);
    try {
      const evaluation = await evaluateResume(selectedJob, resumeText, callClaude, parseJSON);
      const newCandidate = {
        id: \`cand_\${Date.now()}\`,
        jobId: selectedJob.id,
        name: evaluation.name || fileName.replace('.pdf', ''),
        resumeText, fileName, evaluation,
        status: evaluation.recommendation === 'invite' ? 'invited' : 'declined',
        createdAt: Date.now(),
        interview: null,
        finalEvaluation: null
      };
      await saveCandidates([...candidates, newCandidate]);
    } catch (e) {
      setError('Failed to evaluate resume: ' + e.message);
    }
    setProcessing(false);
  }} onOpenCandidate={(c) => { setSelectedCandidate(c); setPage('candidateDetail'); }} processing={processing} />;
  if (page === 'candidateDetail') return <CandidateDetail candidate={selectedCandidate} job={jobs.find(j => j.id === selectedCandidate.jobId)} onBack={() => setPage('jobDetail')} />;
  return null;
}

function JobsList({ jobs, candidates, onOpen, onNew }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Open Roles</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manage job postings and review candidates</p>
        </div>
        <button onClick={onNew} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 flex items-center gap-2">
          <Plus className="w-4 h-4" /> New Role
        </button>
      </div>
      {jobs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Briefcase className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="font-medium text-slate-900 mb-1">No roles yet</h3>
          <p className="text-sm text-slate-500 mb-4">Create your first job posting to start evaluating candidates.</p>
          <button onClick={onNew} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800">Create a role</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {jobs.map(job => {
            const jobCands = candidates.filter(c => c.jobId === job.id);
            const invited = jobCands.filter(c => c.status === 'invited' || c.status === 'interview_complete' || c.status === 'evaluated').length;
            const completed = jobCands.filter(c => c.finalEvaluation).length;
            return (
              <button key={job.id} onClick={() => onOpen(job)} className="bg-white border border-slate-200 rounded-xl p-5 text-left hover:border-slate-300 hover:shadow-sm transition-all group">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-900 truncate">{job.title}</h3>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-1">{job.description.slice(0, 120)}...</p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {jobCands.length} candidates</span>
                      <span className="flex items-center gap-1"><ClipboardCheck className="w-3.5 h-3.5" /> {invited} invited</span>
                      <span className="flex items-center gap-1"><Award className="w-3.5 h-3.5" /> {completed} evaluated</span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 flex-shrink-0 ml-4" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewJob({ onCancel, onCreate }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const handleSubmit = () => {
    if (!title.trim() || !description.trim()) return;
    onCreate({ id: \`job_\${Date.now()}\`, title: title.trim(), description: description.trim(), createdAt: Date.now() });
  };
  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to roles
      </button>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-xl font-semibold text-slate-900 mb-1">Create a new role</h2>
        <p className="text-sm text-slate-500 mb-6">The AI will use these details to evaluate candidates and generate interview questions.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Job title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Senior Product Designer" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Job description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Include responsibilities, required skills, experience level..." rows={10} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={onCancel} className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleSubmit} disabled={!title.trim() || !description.trim()} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed">Create role</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function JobDetail({ job, candidates, onBack, onUpload, onOpenCandidate, processing }) {
  const [resumeText, setResumeText] = useState('');
  const [fileName, setFileName] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try { setResumeText(await file.text()); } catch { setResumeText(''); }
  };

  const handleSubmit = () => {
    if (!resumeText.trim()) return;
    onUpload(resumeText, fileName || 'Candidate.pdf');
    setResumeText(''); setFileName(''); setShowUpload(false);
  };

  const getStatusBadge = (c) => {
    if (c.finalEvaluation) {
      const rec = c.finalEvaluation.recommendation;
      if (rec === 'strong_hire' || rec === 'hire') return <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full">Hire</span>;
      if (rec === 'no_hire') return <span className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded-full">No hire</span>;
      return <span className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">Maybe</span>;
    }
    if (c.status === 'interview_complete') return <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">Interview done</span>;
    if (c.status === 'invited') return <span className="text-xs px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full">Invited</span>;
    if (c.status === 'declined') return <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">Declined</span>;
    return null;
  };

  return (
    <div>
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to roles
      </button>
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-slate-900">{job.title}</h2>
            <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap line-clamp-3">{job.description}</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 flex items-center gap-2 flex-shrink-0">
            <Upload className="w-4 h-4" /> Add candidate
          </button>
        </div>
      </div>
      {showUpload && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-slate-900">Add a candidate</h3>
            <button onClick={() => { setShowUpload(false); setResumeText(''); setFileName(''); }} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Upload resume (text file) or paste below</label>
              <input type="file" accept=".txt,.md" onChange={handleFileUpload} className="text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-sm file:bg-slate-100 file:text-slate-700 file:rounded-md hover:file:bg-slate-200" />
            </div>
            <textarea value={resumeText} onChange={e => setResumeText(e.target.value)} placeholder="Paste resume text here..." rows={10} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none font-mono" />
            <button onClick={handleSubmit} disabled={!resumeText.trim() || processing} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2">
              {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Evaluating...</> : <><Sparkles className="w-4 h-4" /> Evaluate resume</>}
            </button>
          </div>
        </div>
      )}
      <div>
        <h3 className="font-medium text-slate-900 mb-3">Candidates ({candidates.length})</h3>
        {candidates.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No candidates yet. Upload a resume to get started.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {candidates.sort((a, b) => b.createdAt - a.createdAt).map(c => (
              <button key={c.id} onClick={() => onOpenCandidate(c)} className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-slate-300 hover:shadow-sm transition-all group">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-slate-900 truncate">{c.name}</h4>
                      {getStatusBadge(c)}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-1">{c.evaluation.summary}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-semibold text-slate-900">{c.evaluation.matchScore}%</div>
                      <div className="text-xs text-slate-500">resume</div>
                    </div>
                    {c.finalEvaluation && (
                      <div className="text-right border-l border-slate-200 pl-3">
                        <div className="text-lg font-semibold text-slate-900">{c.finalEvaluation.overallScore}%</div>
                        <div className="text-xs text-slate-500">final</div>
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateDetail({ candidate, job, onBack }) {
  const ev = candidate.evaluation;
  const fin = candidate.finalEvaluation;
  return (
    <div>
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to {job.title}
      </button>
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{candidate.name}</h2>
            <p className="text-sm text-slate-500 mt-1">Applied for {job.title}</p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-2xl font-semibold text-slate-900">{ev.matchScore}%</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Resume match</div>
            </div>
            {fin && (
              <div className="border-l border-slate-200 pl-6">
                <div className="text-2xl font-semibold text-slate-900">{fin.overallScore}%</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide">Overall</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-900">Resume Evaluation</h3>
          <span className={\`ml-auto text-xs px-2.5 py-1 rounded-full font-medium \${ev.recommendation === 'invite' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}\`}>
            {ev.recommendation === 'invite' ? 'Recommend interview' : 'Do not proceed'}
          </span>
        </div>
        <p className="text-sm text-slate-700 mb-5 leading-relaxed">{ev.summary}</p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Strengths
            </h4>
            <ul className="space-y-1.5">
              {ev.strengths?.map((s, i) => <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-emerald-600 mt-0.5">•</span><span>{s}</span></li>)}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Gaps
            </h4>
            <ul className="space-y-1.5">
              {ev.gaps?.map((s, i) => <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-amber-600 mt-0.5">•</span><span>{s}</span></li>)}
            </ul>
          </div>
        </div>
      </div>
      {candidate.interview && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-5 h-5 text-slate-400" />
            <h3 className="font-semibold text-slate-900">Interview Responses</h3>
          </div>
          <div className="space-y-5">
            {candidate.interview.rounds.map((r, i) => (
              <div key={i} className="border-l-2 border-slate-200 pl-4">
                <div className="text-sm font-medium text-slate-900 mb-1.5">Q{i + 1}: {r.question}</div>
                <div className="text-sm text-slate-700 mb-3 whitespace-pre-wrap">{r.answer}</div>
                {r.followUp && (
                  <div className="bg-slate-50 rounded-lg p-3 mt-2">
                    <div className="text-xs font-medium text-slate-600 mb-1">Follow-up: {r.followUp}</div>
                    <div className="text-sm text-slate-700 whitespace-pre-wrap">{r.followUpAnswer}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {fin && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-slate-400" />
            <h3 className="font-semibold text-slate-900">Final Evaluation</h3>
            <span className={\`ml-auto text-xs px-2.5 py-1 rounded-full font-medium \${
              fin.recommendation === 'strong_hire' ? 'bg-emerald-100 text-emerald-800' :
              fin.recommendation === 'hire' ? 'bg-emerald-50 text-emerald-700' :
              fin.recommendation === 'maybe' ? 'bg-amber-50 text-amber-700' :
              'bg-red-50 text-red-700'
            }\`}>
              {fin.recommendation === 'strong_hire' ? 'Strong hire' :
               fin.recommendation === 'hire' ? 'Hire' :
               fin.recommendation === 'maybe' ? 'Maybe' : 'No hire'}
            </span>
          </div>
          <p className="text-sm text-slate-700 mb-5 leading-relaxed">{fin.summary}</p>
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Technical', value: fin.scores?.technical },
              { label: 'Experience', value: fin.scores?.experience },
              { label: 'Communication', value: fin.scores?.communication },
              { label: 'Culture fit', value: fin.scores?.cultureFit }
            ].map(s => (
              <div key={s.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-xl font-semibold text-slate-900">{s.value ?? '—'}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Strengths</h4>
              <ul className="space-y-1.5">
                {fin.strengths?.map((s, i) => <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-emerald-600 mt-0.5">•</span><span>{s}</span></li>)}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Concerns</h4>
              <ul className="space-y-1.5">
                {fin.concerns?.map((s, i) => <li key={i} className="text-sm text-slate-700 flex gap-2"><span className="text-amber-600 mt-0.5">•</span><span>{s}</span></li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateView({ page, setPage, jobs, candidates, saveCandidates, selectedJob, setSelectedJob, selectedCandidate, setSelectedCandidate, processing, setProcessing, callClaude, parseJSON, setError }) {
  const invitedCandidates = candidates.filter(c => c.status === 'invited');
  if (page === 'select' || !selectedCandidate) {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-2xl font-semibold text-slate-900">Your Interviews</h2>
          <p className="text-sm text-slate-500 mt-0.5">Select an interview invitation to begin</p>
        </div>
        {invitedCandidates.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <ClipboardCheck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="font-medium text-slate-900 mb-1">No pending interviews</h3>
            <p className="text-sm text-slate-500">Interview invitations will appear here once a recruiter evaluates your resume.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {invitedCandidates.map(c => {
              const job = jobs.find(j => j.id === c.jobId);
              if (!job) return null;
              return (
                <button key={c.id} onClick={async () => {
                  setSelectedCandidate(c); setSelectedJob(job); setProcessing(true); setError(null);
                  try {
                    const questions = await generateQuestions(job, c.resumeText, callClaude, parseJSON);
                    const updated = { ...c, interview: { questions, rounds: [], currentIndex: 0, currentStage: 'main' } };
                    await saveCandidates(candidates.map(x => x.id === c.id ? updated : x));
                    setSelectedCandidate(updated); setPage('interview');
                  } catch (e) { setError('Failed to prepare interview: ' + e.message); }
                  setProcessing(false);
                }} className="bg-white border border-slate-200 rounded-xl p-5 text-left hover:border-slate-300 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-slate-900">{job.title}</h3>
                      <p className="text-sm text-slate-500 mt-1">Interview for {c.name}</p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-violet-700">
                        <Sparkles className="w-3 h-3" /> Ready to start
                      </div>
                    </div>
                    {processing ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-300" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  if (page === 'interview') {
    return <InterviewFlow candidate={selectedCandidate} job={selectedJob}
      onUpdate={async (updated) => { await saveCandidates(candidates.map(x => x.id === updated.id ? updated : x)); setSelectedCandidate(updated); }}
      onComplete={async () => {
        setProcessing(true); setError(null);
        try {
          const finalEvaluation = await evaluateInterview(selectedJob, selectedCandidate, callClaude, parseJSON);
          const updated = { ...selectedCandidate, status: 'evaluated', finalEvaluation };
          await saveCandidates(candidates.map(x => x.id === updated.id ? updated : x));
          setSelectedCandidate(updated); setPage('complete');
        } catch (e) { setError('Failed to evaluate interview: ' + e.message); }
        setProcessing(false);
      }}
      processing={processing} callClaude={callClaude} />;
  }
  if (page === 'complete') {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Interview complete</h2>
        <p className="text-slate-600 mb-6">Thanks for completing your interview for the {selectedJob.title} role. Your responses have been evaluated and sent to the hiring team.</p>
        <button onClick={() => { setPage('select'); setSelectedCandidate(null); setSelectedJob(null); }} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800">Back to interviews</button>
      </div>
    );
  }
  return null;
}

function InterviewFlow({ candidate, job, onUpdate, onComplete, processing, callClaude }) {
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  const interview = candidate.interview;
  const { questions, rounds, currentIndex, currentStage } = interview;
  const currentQuestion = currentStage === 'main' ? questions[currentIndex] : rounds[currentIndex]?.followUp;
  const isLastQuestion = currentIndex === questions.length - 1;

  const handleSubmit = async () => {
    if (!answer.trim()) return;
    if (currentStage === 'main') {
      setThinking(true);
      try {
        const followUp = await generateFollowUp(job, candidate.resumeText, currentQuestion, answer, callClaude);
        const newRound = { question: currentQuestion, answer: answer.trim(), followUp, followUpAnswer: '' };
        const newRounds = [...rounds, newRound];
        await onUpdate({ ...candidate, interview: { ...interview, rounds: newRounds, currentStage: 'followUp' } });
        setAnswer('');
      } catch (e) {
        const newRound = { question: currentQuestion, answer: answer.trim(), followUp: null, followUpAnswer: '' };
        const newRounds = [...rounds, newRound];
        if (isLastQuestion) {
          await onUpdate({ ...candidate, interview: { ...interview, rounds: newRounds }, status: 'interview_complete' });
          onComplete();
        } else {
          await onUpdate({ ...candidate, interview: { ...interview, rounds: newRounds, currentIndex: currentIndex + 1, currentStage: 'main' } });
          setAnswer('');
        }
      }
      setThinking(false);
    } else {
      const updatedRounds = [...rounds];
      updatedRounds[currentIndex] = { ...updatedRounds[currentIndex], followUpAnswer: answer.trim() };
      if (isLastQuestion) {
        await onUpdate({ ...candidate, interview: { ...interview, rounds: updatedRounds }, status: 'interview_complete' });
        onComplete();
      } else {
        await onUpdate({ ...candidate, interview: { ...interview, rounds: updatedRounds, currentIndex: currentIndex + 1, currentStage: 'main' } });
        setAnswer('');
      }
    }
  };

  const totalSteps = questions.length * 2;
  const completedSteps = rounds.length * 2 - (currentStage === 'main' ? 0 : 1);
  const progress = Math.round((completedSteps / totalSteps) * 100);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
          <span>Question {currentIndex + 1} of {questions.length}{currentStage === 'followUp' && ' · Follow-up'}</span>
          <span>{job.title}</span>
        </div>
        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-slate-900 transition-all duration-300" style={{ width: \`\${progress}%\` }} />
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-4">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 bg-slate-900 rounded-full flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            {currentStage === 'followUp' && <div className="text-xs font-medium text-violet-700 mb-1">Follow-up question</div>}
            <p className="text-slate-900 leading-relaxed">{currentQuestion}</p>
          </div>
        </div>
        <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Type your response..." rows={8} disabled={thinking || processing} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none disabled:bg-slate-50" />
        <div className="flex justify-between items-center mt-4">
          <p className="text-xs text-slate-500">Take your time. Be specific with examples.</p>
          <button onClick={handleSubmit} disabled={!answer.trim() || thinking || processing} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2">
            {thinking ? <><Loader2 className="w-4 h-4 animate-spin" /> Thinking...</> :
             processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Evaluating...</> :
             isLastQuestion && currentStage === 'followUp' ? <>Submit interview <Send className="w-4 h-4" /></> :
             <>Next <ChevronRight className="w-4 h-4" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

async function evaluateResume(job, resumeText, callClaude, parseJSON) {
  const prompt = \`You are a senior technical recruiter evaluating a candidate's resume against a specific role.

JOB TITLE: \${job.title}

JOB DESCRIPTION:
\${job.description}

CANDIDATE RESUME:
\${resumeText}

Evaluate this candidate fairly and rigorously. Respond ONLY with a JSON object (no markdown, no preamble) with this exact structure:

{
  "name": "candidate's full name from resume, or 'Unknown Candidate' if not found",
  "matchScore": <integer 0-100 representing how well the resume matches the role>,
  "summary": "<2-3 sentence summary of the candidate's fit for this role>",
  "strengths": ["<specific strength 1>", "<specific strength 2>", "<specific strength 3>"],
  "gaps": ["<specific gap 1>", "<specific gap 2>"],
  "recommendation": "<'invite' if score >= 65 and candidate seems qualified, otherwise 'decline'>"
}

Be specific and reference concrete details from the resume. Do not be overly generous — only recommend invite if there's a genuine fit.\`;
  const text = await callClaude(prompt);
  return parseJSON(text);
}

async function generateQuestions(job, resumeText, callClaude, parseJSON) {
  const prompt = \`You are preparing an interview for a candidate. Generate 4 tailored interview questions based on the job and their specific resume.

JOB TITLE: \${job.title}

JOB DESCRIPTION:
\${job.description}

CANDIDATE RESUME:
\${resumeText}

Generate 4 questions that:
1. The first is a warm-up / intro question about their background and interest in the role
2. The second probes a specific experience from their resume and its relevance
3. The third tests a core skill or competency required for the role (behavioral or situational)
4. The fourth is forward-looking — how they'd approach a challenge specific to this role

Respond ONLY with a JSON object (no markdown):
{
  "questions": ["<q1>", "<q2>", "<q3>", "<q4>"]
}

Keep each question concise (1-2 sentences). Make them specific to this candidate and role, not generic.\`;
  const text = await callClaude(prompt);
  return parseJSON(text).questions;
}

async function generateFollowUp(job, resumeText, question, answer, callClaude) {
  const prompt = \`You are an interviewer. A candidate just answered a question. Generate ONE smart follow-up question that digs deeper into their response.

ROLE: \${job.title}

ORIGINAL QUESTION: \${question}

CANDIDATE'S ANSWER: \${answer}

Your follow-up should:
- Probe for specifics, examples, or reasoning they didn't provide
- Test depth of their experience or thinking
- Be directly tied to something they said
- Be one clear question (1-2 sentences max)

Respond with ONLY the follow-up question text, nothing else. No preamble, no quotation marks.\`;
  const text = await callClaude(prompt);
  return text.trim().replace(/^["']|["']$/g, '');
}

async function evaluateInterview(job, candidate, callClaude, parseJSON) {
  const interviewText = candidate.interview.rounds.map((r, i) =>
    \`Q\${i + 1}: \${r.question}\nAnswer: \${r.answer}\${r.followUp ? \`\n\nFollow-up: \${r.followUp}\nAnswer: \${r.followUpAnswer}\` : ''}\`
  ).join('\n\n---\n\n');

  const prompt = \`You are a senior hiring manager producing a final evaluation for a candidate based on their resume AND interview responses.

JOB TITLE: \${job.title}

JOB DESCRIPTION:
\${job.description}

CANDIDATE RESUME:
\${candidate.resumeText}

INTERVIEW RESPONSES:
\${interviewText}

Produce a rigorous final evaluation. Respond ONLY with a JSON object (no markdown):

{
  "overallScore": <integer 0-100>,
  "scores": {
    "technical": <integer 0-100>,
    "experience": <integer 0-100>,
    "communication": <integer 0-100>,
    "cultureFit": <integer 0-100>
  },
  "summary": "<3-4 sentence summary>",
  "strengths": ["<s1>", "<s2>", "<s3>"],
  "concerns": ["<c1>", "<c2>"],
  "recommendation": "<one of: 'strong_hire', 'hire', 'maybe', 'no_hire'>"
}

Be rigorous and specific. Reference concrete things from their answers.\`;
  const text = await callClaude(prompt);
  return parseJSON(text);
}
