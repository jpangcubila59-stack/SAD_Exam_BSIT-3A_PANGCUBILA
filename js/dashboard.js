(() => {
  const root = document.querySelector('.dashboard-shell');
  const role = root?.dataset.role;
  const message = document.getElementById('dashboard-message');
  const client = window.supabase?.createClient && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;
  let currentUser;
  let assignment;
  let programs = [];
  let staffAssignments = [];
  let staffProfiles = [];
  let submissions = [];
  let history = [];

  function showMessage(text, type = 'error') {
    if (!message) return;
    message.textContent = text;
    message.className = text ? `dashboard-message ${type}` : 'dashboard-message';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function displayDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function statusLabel(value) {
    return ({
      pending: 'Pending',
      verified: 'Verified',
      returned: 'Returned',
      compliant: 'Compliant',
      with_deficiency: 'With deficiency',
      approved: 'Approved',
      held: 'Held'
    })[value] || value || '—';
  }

  function statusPill(value) {
    return `<span class="status-pill status-${escapeHtml(value)}">${escapeHtml(statusLabel(value))}</span>`;
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button[type="submit"], button[data-action]').forEach(button => {
      button.disabled = busy;
    });
  }

  function getSubmissionValues(form) {
    const fields = new FormData(form);
    const values = {
      academic_year: String(fields.get('academic_year')).trim(),
      semester: Number(fields.get('semester')),
      gwa: Number(fields.get('gwa')),
      enrolled_units: Number(fields.get('enrolled_units')),
      failed_count: Number(fields.get('failed_count')),
      incomplete_count: Number(fields.get('incomplete_count')),
      dropped_count: Number(fields.get('dropped_count')),
      evidence_reference: String(fields.get('evidence_reference')).trim()
    };
    if (!/^\d{4}-\d{4}$/.test(values.academic_year)) {
      throw new Error('Enter the academic year as YYYY-YYYY, for example 2026-2027.');
    }
    if (!Number.isFinite(values.gwa) || values.gwa < 1 || values.gwa > 5) {
      throw new Error('GWA must be between 1.00 and 5.00.');
    }
    for (const [label, value] of [
      ['Enrolled units', values.enrolled_units],
      ['Failed subjects', values.failed_count],
      ['Incomplete grades', values.incomplete_count],
      ['Dropped subjects', values.dropped_count]
    ]) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${label} must be a nonnegative whole number.`);
      }
    }
    if (!values.evidence_reference) throw new Error('Enter a grade document reference.');
    return values;
  }

  async function start() {
    if (!client) {
      showMessage('Supabase could not load. Check your connection and js/config.js, then reload.');
      return;
    }
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      window.location.replace('index.html');
      return;
    }
    currentUser = sessionData.session.user;
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, full_name, student_id')
      .eq('id', currentUser.id)
      .single();
    if (profileError) throw profileError;
    const actualRole = ['staff', 'admin'].includes(String(profile.role).toLowerCase()) ? 'staff' : 'scholar';
    if (!['staff', 'admin', 'scholar', 'student'].includes(String(profile.role).toLowerCase())) {
      await client.auth.signOut();
      throw new Error('Your account role is not recognized. Contact the scholarship office.');
    }
    if (actualRole !== role) {
      window.location.replace(actualRole === 'staff' ? 'staff-dashboard.html' : 'scholar-dashboard.html');
      return;
    }
    const welcome = document.getElementById('welcome-message');
    if (welcome) welcome.textContent = `Welcome, ${profile.full_name || currentUser.email}.`;
    document.querySelectorAll('[data-signout]').forEach(button => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        const { error } = await client.auth.signOut();
        if (error) {
          button.disabled = false;
          showMessage(error.message);
          return;
        }
        window.location.replace('index.html');
      });
    });
    document.querySelectorAll('[data-refresh]').forEach(button => {
      button.addEventListener('click', () => refresh().catch(error => showMessage(error.message)));
    });
    if (role === 'staff') {
      bindStaff();
      await refreshStaff();
    } else {
      bindScholar();
      await refreshScholar();
    }
  }

  function bindScholar() {
    document.getElementById('submission-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      setBusy(form, true);
      try {
        if (!assignment) throw new Error('No scholarship assignment is linked to your account. Contact the scholarship office.');
        const values = getSubmissionValues(form);
        const { error } = await client.from('submissions').insert({
          assignment_id: assignment.id,
          ...values
        });
        if (error) throw error;
        form.reset();
        form.elements.academic_year.value = '2026-2027';
        form.elements.failed_count.value = '0';
        form.elements.incomplete_count.value = '0';
        form.elements.dropped_count.value = '0';
        showMessage('Grades submitted. Your evidence is pending staff verification.', 'success');
        await refreshScholar();
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
    document.getElementById('scholar-submissions').addEventListener('submit', async event => {
      const form = event.target.closest('[data-correction-id]');
      if (!form) return;
      event.preventDefault();
      if (!form.reportValidity()) return;
      setBusy(form, true);
      try {
        const values = getSubmissionValues(form);
        const { error } = await client
          .from('submissions')
          .update(values)
          .eq('id', form.dataset.correctionId)
          .select('id')
          .single();
        if (error) throw error;
        showMessage('Correction resubmitted. Verification has returned to Pending.', 'success');
        await refreshScholar();
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
    document.getElementById('scholar-submissions').addEventListener('click', event => {
      const button = event.target.closest('[data-toggle-correction]');
      if (!button) return;
      const correctionForm = document.getElementById(`correction-${button.dataset.toggleCorrection}`);
      correctionForm.hidden = !correctionForm.hidden;
      button.textContent = correctionForm.hidden ? 'Correct and resubmit' : 'Close correction form';
    });
  }

  async function refreshScholar() {
    const { data: foundAssignment, error: assignmentError } = await client
      .from('assignments')
      .select('id, program_id')
      .eq('scholar_id', currentUser.id)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    assignment = foundAssignment;
    const programInput = document.getElementById('scholar-program');
    const form = document.getElementById('submission-form');
    if (!assignment) {
      programInput.value = 'No scholarship program assigned';
      form.querySelector('button[type="submit"]').disabled = true;
      showMessage('Your account has no scholarship assignment yet. Ask staff to assign a program.', 'error');
      renderScholar([]);
      return;
    }
    form.querySelector('button[type="submit"]').disabled = false;
    const { data: program, error: programError } = await client
      .from('programs')
      .select('name')
      .eq('id', assignment.program_id)
      .single();
    if (programError) throw programError;
    programInput.value = program.name;
    const { data: rows, error } = await client
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignment.id)
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    submissions = rows || [];
    if (submissions.length) {
      const { data: events, error: historyError } = await client
        .from('submission_history')
        .select('*')
        .in('submission_id', submissions.map(row => row.id))
        .order('created_at', { ascending: false });
      if (historyError) throw historyError;
      history = events || [];
    } else {
      history = [];
    }
    renderScholar(submissions);
  }

  function correctionForm(row) {
    return `
      <button class="btn btn-outline compact-button" type="button" data-toggle-correction="${escapeHtml(row.id)}">Correct and resubmit</button>
      <form id="correction-${escapeHtml(row.id)}" class="dashboard-form correction-form" data-correction-id="${escapeHtml(row.id)}" hidden>
        <input type="hidden" name="academic_year" value="${escapeHtml(row.academic_year)}">
        <input type="hidden" name="semester" value="${escapeHtml(row.semester)}">
        <p class="form-hint form-wide">Correct the submitted values below. Academic year and semester cannot be changed.</p>
        <label>GWA<input name="gwa" type="number" min="1" max="5" step="0.01" value="${escapeHtml(row.gwa)}" required></label>
        <label>Enrolled units<input name="enrolled_units" type="number" min="0" step="1" value="${escapeHtml(row.enrolled_units)}" required></label>
        <label>Failed subjects<input name="failed_count" type="number" min="0" step="1" value="${escapeHtml(row.failed_count)}" required></label>
        <label>Incomplete grades<input name="incomplete_count" type="number" min="0" step="1" value="${escapeHtml(row.incomplete_count)}" required></label>
        <label>Dropped subjects<input name="dropped_count" type="number" min="0" step="1" value="${escapeHtml(row.dropped_count)}" required></label>
        <label class="form-wide">Grade document reference<input name="evidence_reference" value="${escapeHtml(row.evidence_reference)}" maxlength="500" required></label>
        <button class="btn btn-primary form-action" type="submit">Resubmit correction</button>
      </form>`;
  }

  function renderScholar(rows) {
    const container = document.getElementById('scholar-submissions');
    if (!rows.length) {
      container.innerHTML = '<p class="empty-state">No semester submissions yet.</p>';
      return;
    }
    container.innerHTML = rows.map(row => `
      <article class="record-card">
        <div class="record-heading">
          <div><h3>${escapeHtml(row.academic_year)} · ${row.semester === 3 ? 'Summer' : `Semester ${row.semester}`}</h3>
          <p>Submitted ${escapeHtml(displayDate(row.submitted_at))}</p></div>
          ${statusPill(row.verification_status)}
        </div>
        <div class="status-row">
          <span>Compliance ${statusPill(row.compliance_status)}</span>
          <span>Renewal ${statusPill(row.renewal_status)}</span>
          <span>Award ${statusPill(assignment?.award_status || 'active')}</span>
        </div>
        <dl class="detail-grid">
          <div><dt>GWA</dt><dd>${escapeHtml(row.gwa)}</dd></div>
          <div><dt>Enrolled units</dt><dd>${escapeHtml(row.enrolled_units)}</dd></div>
          <div><dt>Failed / Incomplete / Dropped</dt><dd>${escapeHtml(row.failed_count)} / ${escapeHtml(row.incomplete_count)} / ${escapeHtml(row.dropped_count)}</dd></div>
          <div><dt>Evidence reference</dt><dd>${escapeHtml(row.evidence_reference)}</dd></div>
        </dl>
        ${row.verification_reason ? `<p class="reason-text"><strong>Staff feedback:</strong> ${escapeHtml(row.verification_reason)}</p>` : ''}
        ${Array.isArray(row.compliance_reasons) && row.compliance_reasons.length
          ? `<ul class="reason-list">${row.compliance_reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
        ${row.renewal_note ? `<p class="reason-text"><strong>Decision note:</strong> ${escapeHtml(row.renewal_note)}</p>` : ''}
        ${renderScholarHistory(row.id)}
        ${row.verification_status === 'returned' ? correctionForm(row) : ''}
      </article>`).join('');
  }

  function renderScholarHistory(submissionId) {
    const events = history.filter(item => item.submission_id === submissionId);
    if (!events.length) return '';
    const labels = {
      submitted: 'Submitted',
      verified: 'Evidence verified',
      returned: 'Returned for correction',
      evaluated: 'Compliance evaluated',
      renewal_decided: 'Renewal decision recorded',
      corrected_and_resubmitted: 'Correction resubmitted'
    };
    return `<details class="record-history">
      <summary>Activity history (${events.length})</summary>
      <ul>${events.map(item => `<li><strong>${escapeHtml(labels[item.action] || item.action)}</strong>
        <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(displayDate(item.created_at))}</time>
        ${item.details?.reason ? `<span>${escapeHtml(item.details.reason)}</span>` : ''}
        ${item.details?.note ? `<span>${escapeHtml(item.details.note)}</span>` : ''}
      </li>`).join('')}</ul>
    </details>`;
  }

  function bindStaff() {
    document.getElementById('assignment-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      setBusy(form, true);
      try {
        const fields = new FormData(form);
        const scholarId = String(fields.get('scholar_id')).trim();
        const { data: existing, error: lookupError } = await client
          .from('profiles')
          .select('role')
          .eq('id', scholarId)
          .maybeSingle();
        if (lookupError) throw lookupError;
        if (existing && existing.role !== 'scholar') {
          throw new Error('That Auth user already has a staff or admin profile and cannot be assigned as a scholar.');
        }
          const { data: currentAssignment, error: assignmentLookupError } = await client
            .from('assignments')
            .select('id')
            .eq('scholar_id', scholarId)
            .maybeSingle();
          if (assignmentLookupError) throw assignmentLookupError;
          if (currentAssignment) throw new Error('This scholar already has an assignment. Contact an administrator to change the assigned program.');
          if (!existing) {
          const { error: profileError } = await client.from('profiles').insert({
            id: scholarId,
            email: String(fields.get('email')).trim(),
            full_name: String(fields.get('full_name')).trim(),
            student_id: String(fields.get('student_id')).trim(),
            role: 'scholar'
          });
          if (profileError) throw profileError;
        } else {
          const { error: profileError } = await client.from('profiles')
            .update({
              email: String(fields.get('email')).trim(),
              full_name: String(fields.get('full_name')).trim(),
              student_id: String(fields.get('student_id')).trim()
            })
            .eq('id', scholarId)
            .select('id')
            .single();
          if (profileError) throw profileError;
        }
        const { error } = await client.from('assignments').insert({
          scholar_id: scholarId,
          program_id: String(fields.get('program_id'))
        });
        if (error) throw error;
        form.reset();
        showMessage('Scholar profile and program assignment saved.', 'success');
        await refreshStaff();
      } catch (error) {
        showMessage(error.message);
      } finally {
        setBusy(form, false);
      }
    });
    ['filter-year', 'filter-semester', 'filter-program', 'filter-compliance', 'search-records'].forEach(id => {
      const element = document.getElementById(id);
      element.addEventListener('input', renderStaffRecords);
      element.addEventListener('change', renderStaffRecords);
    });
    document.getElementById('staff-submissions').addEventListener('click', handleStaffAction);
  }

  async function refreshStaff() {
    const results = await Promise.all([
      client.from('programs').select('*').order('name'),
      client.from('assignments').select('*').order('created_at', { ascending: false }),
      client.from('submissions').select('*').order('submitted_at', { ascending: false }),
      client.from('submission_history').select('*').order('created_at', { ascending: false }).limit(100)
    ]);
    for (const result of results) if (result.error) throw result.error;
    programs = results[0].data || [];
    staffAssignments = results[1].data || [];
    submissions = results[2].data || [];
    history = results[3].data || [];
    const scholarIds = [...new Set(staffAssignments.map(item => item.scholar_id))];
    const actorIds = [...new Set(history.map(item => item.actor_id).filter(Boolean))];
    const profileIds = [...new Set([...scholarIds, ...actorIds])];
    if (profileIds.length) {
      const { data: profiles, error } = await client
        .from('profiles')
        .select('id, student_id, full_name, email')
        .in('id', profileIds);
      if (error) throw error;
      staffProfiles = profiles || [];
    } else {
      staffProfiles = [];
    }
    populatePrograms();
    renderStaffRecords();
    renderHistory();
  }

  function populatePrograms() {
    const assignmentSelect = document.getElementById('program-select');
    const filterSelect = document.getElementById('filter-program');
    const previous = assignmentSelect.value;
    assignmentSelect.innerHTML = '<option value="">Select a program</option>' + programs
      .map(program => `<option value="${escapeHtml(program.id)}">${escapeHtml(program.name)}</option>`).join('');
    if (previous) assignmentSelect.value = previous;
    const filter = filterSelect.value;
    filterSelect.innerHTML = '<option value="">All programs</option>' + programs
      .map(program => `<option value="${escapeHtml(program.id)}">${escapeHtml(program.name)}</option>`).join('');
    filterSelect.value = filter;
  }

  function getRecordContext(row) {
    const assignmentRow = staffAssignments.find(item => item.id === row.assignment_id);
    const scholar = staffProfiles.find(item => item.id === assignmentRow?.scholar_id) || {};
    const program = programs.find(item => item.id === assignmentRow?.program_id) || {};
    return { assignmentRow, scholar, program };
  }

  function renderStaffRecords() {
    const year = document.getElementById('filter-year').value.trim();
    const semester = Number(document.getElementById('filter-semester').value);
    const programFilter = document.getElementById('filter-program').value;
    const complianceFilter = document.getElementById('filter-compliance').value;
    const search = document.getElementById('search-records').value.trim().toLowerCase();
    const semesterRows = submissions.filter(row => row.academic_year === year && row.semester === semester);
    document.getElementById('metric-assigned').textContent = String(staffAssignments.length);
    document.getElementById('metric-pending').textContent = String(semesterRows.filter(row => row.verification_status === 'pending').length);
    document.getElementById('metric-compliant').textContent = String(semesterRows.filter(row => row.compliance_status === 'compliant').length);
    document.getElementById('metric-deficiency').textContent = String(semesterRows.filter(row => row.compliance_status === 'with_deficiency').length);
    const filtered = semesterRows.filter(row => {
      const { assignmentRow, scholar } = getRecordContext(row);
      const searchable = `${scholar.full_name || ''} ${scholar.student_id || ''} ${scholar.email || ''}`.toLowerCase();
      return (!programFilter || assignmentRow?.program_id === programFilter)
        && (!complianceFilter || row.compliance_status === complianceFilter)
        && (!search || searchable.includes(search));
    });
    const container = document.getElementById('staff-submissions');
    if (!filtered.length) {
      container.innerHTML = '<p class="empty-state">No submissions match this semester and filter.</p>';
      return;
    }
    container.innerHTML = filtered.map(row => {
      const { scholar, program } = getRecordContext(row);
      const canEvaluate = row.verification_status === 'verified';
      const canDecide = canEvaluate && row.compliance_status !== 'pending';
      return `
        <article class="record-card staff-record">
          <div class="record-heading">
            <div><h3>${escapeHtml(scholar.full_name || 'Scholar')} <span class="record-id">${escapeHtml(scholar.student_id || '')}</span></h3>
            <p>${escapeHtml(scholar.email || '')} · ${escapeHtml(program.name || 'Unassigned program')} · ${escapeHtml(row.academic_year)} ${row.semester === 3 ? 'Summer' : `Semester ${escapeHtml(row.semester)}`}</p></div>
            ${statusPill(row.verification_status)}
          </div>
          <div class="status-row">
            <span>Compliance ${statusPill(row.compliance_status)}</span>
            <span>Renewal ${statusPill(row.renewal_status)}</span>
            <span>Award ${statusPill(assignmentRow?.award_status || 'active')}</span>
          </div>
          <dl class="detail-grid">
            <div><dt>GWA / limit</dt><dd>${escapeHtml(row.gwa)} / ${escapeHtml(program.max_gwa ?? '—')}</dd></div>
            <div><dt>Units / minimum</dt><dd>${escapeHtml(row.enrolled_units)} / ${escapeHtml(program.min_units ?? '—')}</dd></div>
            <div><dt>Failed / INC / dropped</dt><dd>${escapeHtml(row.failed_count)} / ${escapeHtml(row.incomplete_count)} / ${escapeHtml(row.dropped_count)}</dd></div>
            <div><dt>Submitted</dt><dd>${escapeHtml(displayDate(row.submitted_at))}</dd></div>
            <div class="detail-wide"><dt>Evidence reference</dt><dd>${escapeHtml(row.evidence_reference)}</dd></div>
          </dl>
          ${row.verification_reason ? `<p class="reason-text"><strong>Verification feedback:</strong> ${escapeHtml(row.verification_reason)}</p>` : ''}
          ${Array.isArray(row.compliance_reasons) && row.compliance_reasons.length
            ? `<ul class="reason-list">${row.compliance_reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}
          ${row.renewal_note ? `<p class="reason-text"><strong>Decision note:</strong> ${escapeHtml(row.renewal_note)}</p>` : ''}
          <div class="staff-actions">
            <label>Return reason (required when returning)
              <input type="text" data-reason-for="${escapeHtml(row.id)}" value="${escapeHtml(row.verification_reason || '')}" placeholder="Explain what needs correction">
            </label>
            <div class="action-buttons">
              ${row.verification_status === 'pending' || row.verification_status === 'returned'
                ? `<button type="button" class="btn btn-outline compact-button" data-action="verify" data-id="${escapeHtml(row.id)}">Mark verified</button>
                   <button type="button" class="btn btn-outline compact-button" data-action="return" data-id="${escapeHtml(row.id)}">Return for correction</button>` : ''}
              ${canEvaluate && row.compliance_status === 'pending'
                ? `<button type="button" class="btn btn-primary compact-button" data-action="evaluate" data-id="${escapeHtml(row.id)}">Evaluate compliance</button>` : ''}
            </div>
            ${canDecide ? `<label>Decision note
              <input type="text" data-note-for="${escapeHtml(row.id)}" value="${escapeHtml(row.renewal_note || '')}" placeholder="Required for approval or hold">
            </label>
            <div class="action-buttons">
              ${row.renewal_status === 'pending' || row.renewal_status === 'held'
                ? `<button type="button" class="btn btn-primary compact-button" data-action="approve" data-id="${escapeHtml(row.id)}" ${row.compliance_status !== 'compliant' ? 'disabled title="Approval requires a compliant evaluation"' : ''}>Approve renewal</button>` : ''}
              ${row.renewal_status !== 'held'
                ? `<button type="button" class="btn btn-outline compact-button" data-action="hold" data-id="${escapeHtml(row.id)}">Hold renewal</button>` : ''}
            </div>` : ''}
          </div>
        </article>`;
    }).join('');
  }

  async function handleStaffAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    button.disabled = true;
    try {
      let update;
      if (action === 'verify' || action === 'return') {
        const reason = document.querySelector(`[data-reason-for="${CSS.escape(id)}"]`)?.value.trim() || '';
        if (action === 'return' && !reason) throw new Error('Enter a reason before returning the submission.');
        update = {
          verification_status: action === 'verify' ? 'verified' : 'returned',
          verification_reason: action === 'return' ? reason : null
        };
      } else if (action === 'evaluate') {
        update = { compliance_status: 'compliant' };
      } else {
        const note = document.querySelector(`[data-note-for="${CSS.escape(id)}"]`)?.value.trim() || '';
        if (!note) throw new Error('Enter a decision note before approving or holding renewal.');
        update = { renewal_status: action === 'approve' ? 'approved' : 'held', renewal_note: note };
      }
      const { error } = await client
        .from('submissions')
        .update(update)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      showMessage(action === 'evaluate'
        ? 'Compliance evaluated using the assigned program policy.'
        : 'Submission updated and activity recorded.', 'success');
      await refreshStaff();
    } catch (error) {
      button.disabled = false;
      showMessage(error.message);
    }
  }

  function renderHistory() {
    const container = document.getElementById('submission-history');
    if (!history.length) {
      container.innerHTML = '<p class="empty-state">No submission activity has been recorded yet.</p>';
      return;
    }
    const actionNames = {
      submitted: 'Submission created',
      verified: 'Evidence verified',
      returned: 'Evidence returned',
      evaluated: 'Compliance evaluated',
      renewal_decided: 'Renewal decision recorded',
      corrected_and_resubmitted: 'Correction resubmitted'
    };
    container.innerHTML = history.map(item => {
      const row = submissions.find(submission => submission.id === item.submission_id);
      const { scholar } = row ? getRecordContext(row) : { scholar: {} };
      const actor = staffProfiles.find(profile => profile.id === item.actor_id);
      return `<article class="history-item">
        <div><strong>${escapeHtml(actionNames[item.action] || item.action)}</strong>
          <span>${escapeHtml(scholar.full_name || 'Scholar')} · ${escapeHtml(actor?.full_name || actor?.email || 'System')}</span></div>
        <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(displayDate(item.created_at))}</time>
        ${item.details?.reason ? `<p>${escapeHtml(item.details.reason)}</p>` : ''}
        ${item.details?.note ? `<p>${escapeHtml(item.details.note)}</p>` : ''}
      </article>`;
    }).join('');
  }

  async function refresh() {
    if (role === 'staff') await refreshStaff();
    else await refreshScholar();
  }

  start().catch(error => {
    showMessage(error.message || 'Unable to load the dashboard.');
  });
})();
