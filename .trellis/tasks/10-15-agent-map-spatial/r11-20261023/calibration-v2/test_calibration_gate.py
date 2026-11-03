"""Synthetic evidence only; these tests never create real human labels or API calls."""
import copy
import importlib.util
import json
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('calibration_gate', HERE / 'calibration_gate.py')
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


class GateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r11-gate-unit-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.here = self.root / 'calibration-v2'
        self.here.mkdir()
        for name in ('rubric.md', 'output-schema.json', 'judge-config.schema.json', 'judge-config.example.json'):
            (self.here / name).write_bytes((HERE / name).read_bytes())
        self.config = self.here / 'judge-config.example.json'
        write(self.root / 'calibration-manifest.json', {'syntheticTestOnly': True})
        self.rows, inputs, labels, suggestions = [], [], [], []
        self.verdicts = {}
        for index in range(24):
            cid = f'UNIT-{index:02}'
            verdict = 'fail' if index % 2 else 'pass'
            self.verdicts[cid] = verdict
            native = [{'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'Synthetic unit test only.'}]}},
                      {'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': f'Unit evidence {cid}.'}]}}]
            source, review_path = self.root / f'{cid}.jsonl', self.root / f'{cid}.review.json'
            source.write_text('\n'.join(json.dumps(row) for row in native) + '\n')
            review = {'fixture': {'before': {'test': True}}, 'after': {'test': True}, 'hiddenScore': 'excluded'}
            write(review_path, review)
            inp = {'id': cid, 'unit': 'single_visible_claim_with_context', 'claim': f'Unit evidence {cid}.',
                   'claimContext': f'Unit evidence {cid}.', 'transcriptThroughClaim': gate.native_projection(native, 2),
                   'stateEvidence': gate.expected_state(review), 'evaluationInstructions': {key: 'Synthetic temporal contract.' for key in
                    ('judgmentUnit', 'contemporaneousEvidence', 'stateEvidenceTiming', 'plansAndConditions')}}
            row = {'id': cid, 'split': 'development' if index < 16 else 'validation',
                   'family': 'dev-family' if index < 16 else 'validation-family',
                   'transcriptPath': source.name, 'transcriptSha256': gate.sha(source),
                   'reviewPath': review_path.name, 'reviewSha256': gate.sha(review_path),
                   'sourceLine': 2, 'sourceIndexZeroBased': 1, 'claim': inp['claim'], 'inputSha256': gate.input_hash(inp),
                   'exposure': {'validationAudit': 'frozen_eligible', 'newJudgeDevelopmentExample': index < 16}}
            self.rows.append(row); inputs.append(inp)
            labels.append({'id': cid, 'verdict': verdict, 'severity': 'none' if verdict == 'pass' else 'material',
                           'clarity': 'clear', 'reviewer': 'synthetic test fixture',
                           'confirmedAt': '2026-10-24T00:00:00Z', 'reason': 'Unit test, not human evidence.',
                           'confirmationSource': 'synthetic-test-only'})
            suggestions.append({'id': cid, 'proposedVerdict': verdict})
        self.manifest = {'schemaVersion': 2, 'target': {'development': 16, 'validation': 8, 'validationPass': 4, 'validationFail': 4},
                         'records': self.rows, 'materialBlockers': [], 'legacyManifestSha256': gate.sha(self.root / 'calibration-manifest.json')}
        write(self.here / 'selection-manifest.json', self.manifest)
        write(self.here / 'inputs.json', {'records': inputs})
        write(self.here / 'human-labels.json', {'records': labels})
        write(self.here / 'suggestions.json', {'records': suggestions})
        self.results_path = self.root / 'synthetic-results' / 'results.json'
        self.make_results()

    def make_results(self):
        cfg = gate.read(self.config)
        inputs = gate.unique_records(gate.read(self.here / 'inputs.json'), 'inputs')
        records = []
        for row in self.rows:
            cid = row['id']; verdict = self.verdicts[cid]
            request = {'model': cfg['model'], 'max_tokens': cfg['maxTokens'], 'thinking': cfg['thinking'], 'stream': False,
                       'response_format': {'type': 'json_object'}, 'messages': [
                        {'role': 'system', 'content': (self.here / 'rubric.md').read_text()},
                        {'role': 'user', 'content': json.dumps(inputs[cid])}]}
            output = {'schemaVersion': 1, 'id': cid, 'unit': 'claim', 'verdict': verdict,
                      'severity': 'none' if verdict == 'pass' else 'material',
                      'axes': {key: verdict if key == 'evidence' else 'na' for key in gate.AXES}, 'clarity': 'clear',
                      'reason': 'Synthetic gate test; not an actual judgment.',
                      'evidence': [{'sourceLine': inputs[cid]['transcriptThroughClaim'][-1]['sourceLine'],
                                    'quote': inputs[cid]['transcriptThroughClaim'][-1]['message']['content'][0]['text'],
                                    'interpretation': 'Unit evidence.'}]}
            response = {'id': f'synthetic-request-{cid}', 'model': cfg['responseModel'],
                        'usage': {'prompt_tokens': 100, 'completion_tokens': 25},
                        'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': json.dumps(output)}}]}
            paths = {name: self.results_path.parent / f'{cid}.{name}.json' for name in ('request', 'response', 'output')}
            for name, value in [('request', request), ('response', response), ('output', output)]:write(paths[name], value)
            records.append({'id': cid, **{f'{name}Path': p.name for name, p in paths.items()},
                            **{f'{name}Sha256': gate.sha(p) for name, p in paths.items()},
                            'requestId': response['id'], 'model': response['model'],
                            'startedAt': '2026-10-24T00:00:01Z', 'completedAt': '2026-10-24T00:00:02Z',
                            'usage': {'inputTokens': 100, 'outputTokens': 25}})
        write(self.results_path, {'schemaVersion': 1, 'kind': 'calibration',
                                 'bindings': gate.bindings(self.here, self.config), 'records': records})

    def new_policy_fixture(self):
        # setUp owns a TemporaryDirectory; no historical worktree evidence is opened here.
        self.assertEqual(self.root, Path(self.temp.name))
        self.assertTrue(self.root.name.startswith('r11-gate-unit-test-'))
        inputs = gate.unique_records(gate.read(self.here / 'inputs.json'), 'inputs')
        labels = gate.read(self.here / 'human-labels.json')
        write(self.here / 'human-labels-before-reselection-20261025.json', {'records': copy.deepcopy(labels['records'][:16])})
        for name in ('exposure-audit.md', 'human-confirmation-20261025.md'):
            (self.here / name).write_text('Synthetic unit test document, not human evidence.\n')
        for index, row in enumerate(self.rows[16:], 16):
            cid = row['id']
            source = self.root / row['transcriptPath']
            native = [json.loads(line) for line in source.read_text().splitlines()]
            native[1]['message']['content'][0]['text'] = 'Reviewed scope.\n\n' + row['claim']
            source.write_text('\n'.join(json.dumps(item) for item in native) + '\n')
            provider = self.root / (cid + '.provider.json')
            write(provider, {'syntheticTestOnly': True})
            row.update(sampleOrigin='real_historical_output', evidencePolicy=gate.NEW_EVIDENCE_POLICY,
                       transcriptSha256=gate.sha(source), providerPath=provider.name,
                       providerSha256=gate.sha(provider), originalCaseKind='UNIT', contextSpans=[{'start': 0, 'end': 15}])
            if index >= 21:
                base = self.rows[16 + (index - 21)]
                for key in ('transcriptPath', 'transcriptSha256', 'reviewPath', 'reviewSha256', 'providerPath', 'providerSha256', 'contextSpans'):
                    row[key] = copy.deepcopy(base[key])
                row.update(sampleOrigin='constructed_counterexample', claim=f'Constructed statement {cid}.',
                           derivation={'baseEvidence': base['id'], 'changedField': 'claim', 'originalClaim': base['claim'],
                                       'replacementClaim': f'Constructed statement {cid}.', 'method': 'replace_selected_claim_only'})
            native = [json.loads(line) for line in (self.root / row['transcriptPath']).read_text().splitlines()]
            text = native[1]['message']['content'][0]['text']
            inp = {'id': cid, 'unit': 'single_visible_claim_with_context', 'claim': row['claim'],
                   'claimContext': gate.selected_context(row, text), 'transcriptThroughClaim': gate.native_projection(native, 1),
                   'stateEvidence': {}, 'evaluationInstructions': gate.NEW_INSTRUCTIONS}
            row['inputSha256'] = gate.input_hash(inp); inputs[cid] = inp
            verdict = 'fail' if index in (17, 21, 22, 23) else 'pass'
            labels['records'][index].update(verdict=verdict, severity='material' if verdict == 'fail' else 'none')
            self.verdicts[cid] = verdict
        self.manifest['validationSelection'] = {
            'ids': [r['id'] for r in self.rows[16:]], 'rubricSha256AtSelection': gate.sha(self.here / 'rubric.md'),
            'exposureAuditSha256': gate.sha(self.here / 'exposure-audit.md'),
            'confirmationSha256': gate.sha(self.here / 'human-confirmation-20261025.md'),
            'oldHumanLabelsSha256': gate.sha(self.here / 'human-labels-before-reselection-20261025.json')}
        write(self.here / 'selection-manifest.json', self.manifest)
        write(self.here / 'inputs.json', {'records': list(inputs.values())})
        write(self.here / 'human-labels.json', labels)
        self.make_results()
        result = self.check('verify-labels')
        self.assertTrue(result['ready'], result)

    def test_five_historical_three_constructed_keep_same_evidence_cutoff(self):
        self.new_policy_fixture()
        result = self.check('verify-labels')
        self.assertEqual(result['summary']['validationOrigins'], {'real_historical_output': 5, 'constructed_counterexample': 3})
        inputs = gate.unique_records(gate.read(self.here / 'inputs.json'), 'inputs')
        for row in self.rows[16:]:
            inp = inputs[row['id']]
            self.assertEqual(inp['stateEvidence'], {})
            self.assertTrue(all(m['sourceLine'] < row['sourceLine'] for m in inp['transcriptThroughClaim']))
            if row['sampleOrigin'] == 'constructed_counterexample':
                self.assertNotIn(row['derivation']['originalClaim'], inp['claimContext'])
                self.assertEqual(inp['transcriptThroughClaim'], inputs[row['derivation']['baseEvidence']]['transcriptThroughClaim'])
        self.assertEqual(inputs['UNIT-00']['stateEvidence']['after'], {'test': True})

    def test_constructed_and_historical_share_actual_result_agreement_gate(self):
        self.new_policy_fixture()
        result = self.check()
        self.assertTrue(result['ready'], result)
        self.assertEqual(result['summary']['validationAgreement'], 8)
        self.verdicts['UNIT-23'] = 'pass'; self.make_results()
        self.assert_blocked('agreement 7/8')

    def test_constructed_cannot_impersonate_native_history(self):
        self.new_policy_fixture()
        self.rows[-1]['sampleOrigin'] = 'real_historical_output'
        del self.rows[-1]['derivation']
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('quote is not original')

    def test_constructed_cannot_modify_base_evidence(self):
        self.new_policy_fixture()
        self.rows[-1]['providerSha256'] = 'fake'
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('constructed base')

    def test_constructed_cannot_modify_base_context(self):
        self.new_policy_fixture()
        self.rows[-1]['contextSpans'] = []
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('constructed base')

    def test_new_input_cannot_leak_original_answer_or_post_state(self):
        self.new_policy_fixture()
        for field, value, error in [('claimContext', 'Original correct answer.', 'claim/context mismatch'),
                                   ('stateEvidence', {'after': 'later'}, 'post-answer state')]:
            with self.subTest(field=field):
                document = gate.read(self.here / 'inputs.json')
                original = copy.deepcopy(document)
                document['records'][-1][field] = value
                self.rows[-1]['inputSha256'] = gate.input_hash(document['records'][-1])
                write(self.here / 'inputs.json', document);write(self.here / 'selection-manifest.json', self.manifest)
                self.assert_blocked(error)
                write(self.here / 'inputs.json', original)
                self.rows[-1]['inputSha256'] = gate.input_hash(original['records'][-1])
                write(self.here / 'selection-manifest.json', self.manifest)

    def test_new_input_excludes_selected_source_answer_even_after_rehash(self):
        self.new_policy_fixture()
        document = gate.read(self.here / 'inputs.json'); inp = document['records'][-1]
        native = [json.loads(line) for line in (self.root / self.rows[-1]['transcriptPath']).read_text().splitlines()]
        inp['transcriptThroughClaim'] = gate.native_projection(native, 2)
        self.rows[-1]['inputSha256'] = gate.input_hash(inp)
        write(self.here / 'inputs.json', document);write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('includes selected answer')

    def test_frozen_exposure_and_old_labels_cannot_be_silently_changed(self):
        self.new_policy_fixture()
        (self.here / 'exposure-audit.md').write_text('Changed audit')
        self.assert_blocked('exposure audit drift')
        (self.here / 'exposure-audit.md').write_text('Synthetic unit test document, not human evidence.\n')
        document = gate.read(self.here / 'human-labels.json');document['records'][0]['reason'] += ' altered'
        write(self.here / 'human-labels.json', document)
        self.assert_blocked('old human labels must remain unchanged')

    def test_selected_rubric_cannot_be_tuned_after_reselection(self):
        self.new_policy_fixture()
        with (self.here / 'rubric.md').open('a') as handle:
            handle.write('New example to teach the expected answer.')
        self.assert_blocked('rubric changed since validation selection')

    def check(self, mode='verify'):
        return gate.verify_gate(self.here, self.root, self.config, self.results_path, mode)

    def assert_blocked(self, phrase):
        result = self.check()
        self.assertFalse(result['ready'])
        self.assertIn(phrase, '\n'.join(result['errors']))

    def test_synthetic_full_evidence_passes_and_awkward_can_be_factually_correct(self):
        result = self.check()
        self.assertTrue(result['ready'], result)
        self.assertEqual(result['summary']['validationAgreement'], 8)
        output = gate.read(self.results_path.parent / 'UNIT-00.output.json')
        output['clarity'] = 'awkward'
        gate.validate_output(output, gate.read(self.here / 'output-schema.json'))

    def test_cli_validate_output_enforces_input_id_and_unit(self):
        inp = self.root / 'single-input.json'
        write(inp, {'id': 'UNIT-00', 'unit': 'single_visible_claim_with_context'})
        command = [sys.executable, str(HERE / 'calibration_gate.py'), '--validate-output',
                   str(self.results_path.parent / 'UNIT-00.output.json'), '--input', str(inp)]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(json.loads(result.stdout)['valid'])
        write(inp, {'id': 'UNIT-00', 'unit': 'task'})
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('unit mismatch', result.stdout)

    def test_task_cannot_pass_with_only_final_facts_applicable(self):
        output = gate.read(self.results_path.parent / 'UNIT-00.output.json')
        output['unit'] = 'task'
        output['axes'] = {key: 'pass' if key == 'finalFacts' else 'na' for key in gate.AXES}
        with self.assertRaisesRegex(ValueError, 'task core axes cannot be na'):
            gate.validate_output(output, gate.read(self.here / 'output-schema.json'))
        output['axes'] = {key: 'na' if key == 'processFacts' else 'pass' for key in gate.AXES}
        gate.validate_output(output, gate.read(self.here / 'output-schema.json'))

    def test_no_ready_boolean_can_replace_evidence(self):
        write(self.results_path, {'ready': True})
        self.assert_blocked('unexpected calibration result fields')

    def test_material_integrity_does_not_mean_execution_ready(self):
        document = gate.read(self.here / 'human-labels.json')
        document['records'][0]['verdict'] = None
        write(self.here / 'human-labels.json', document)
        result = self.check('materials-only')
        self.assertEqual(result['errors'], [])
        self.assertFalse(result['ready'])
        self.assertIn('blank', '\n'.join(result['readinessErrors']))
        self.assert_blocked('blank')

    def test_missing_calibration_results_block_after_labels(self):
        self.results_path.unlink()
        self.assert_blocked('No such file')

    def test_pending_and_wrong_ratio_block(self):
        document = gate.read(self.here / 'human-labels.json')
        document['records'][-1].update(verdict='pass', severity='none')
        write(self.here / 'human-labels.json', document)
        self.assert_blocked('4 pass / 4 fail')

    def test_manifest_not_frozen_blocks(self):
        self.manifest['records'][-1]['exposure']['validationAudit'] = 'not_frozen'
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('validation exposure audit not frozen')

    def test_family_leak_blocks(self):
        self.manifest['records'][-1]['family'] = 'dev-family'
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('scenario family crosses')

    def test_group_labels_cannot_enter_judge_input(self):
        document = gate.read(self.here / 'inputs.json')
        document['records'][0]['group'] = 'S1-P'
        write(self.here / 'inputs.json', document)
        self.assert_blocked('unapproved input fields')

    def test_future_or_hidden_context_blocked_even_if_hash_refreshed(self):
        document = gate.read(self.here / 'inputs.json')
        document['records'][0]['transcriptThroughClaim'].append({'sourceLine': 3, 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Later success'}]}})
        write(self.here / 'inputs.json', document)
        self.manifest['records'][0]['inputSha256'] = gate.input_hash(document['records'][0])
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('visible context projection differs')

    def test_state_evidence_not_silently_rewritten(self):
        document = gate.read(self.here / 'inputs.json')
        document['records'][0]['stateEvidence']['after']['fake'] = True
        write(self.here / 'inputs.json', document)
        self.manifest['records'][0]['inputSha256'] = gate.input_hash(document['records'][0])
        write(self.here / 'selection-manifest.json', self.manifest)
        self.assert_blocked('state evidence projection mismatch')

    def test_changed_labels_do_not_reuse_old_calibration(self):
        document = gate.read(self.here / 'human-labels.json')
        document['records'][0]['reason'] += ' Updated.'
        write(self.here / 'human-labels.json', document)
        self.assert_blocked('frozen hashes mismatch')

    def test_raw_request_cannot_include_hidden_answer_even_with_new_digest(self):
        document = gate.read(self.results_path)
        record = document['records'][0]
        path = self.results_path.parent / record['requestPath']
        request = gate.read(path)
        user = json.loads(request['messages'][1]['content']); user['humanVerdict'] = 'pass'
        request['messages'][1]['content'] = json.dumps(user)
        write(path, request); record['requestSha256'] = gate.sha(path); write(self.results_path, document)
        self.assert_blocked('judge input leak or drift')

    def test_raw_response_verdict_required_not_just_saved_output(self):
        document = gate.read(self.results_path); record = document['records'][0]
        path = self.results_path.parent / record['outputPath']
        output = gate.read(path); output['reason'] = 'Changed without raw response'
        write(path, output); record['outputSha256'] = gate.sha(path); write(self.results_path, document)
        self.assert_blocked('differs from provider response')

    def test_false_pass_is_detected_by_actual_eight_outputs(self):
        self.verdicts['UNIT-17'] = 'pass'
        self.make_results()
        self.assert_blocked('agreement 7/8')

    def test_critical_false_pass_is_reported(self):
        document = gate.read(self.here / 'human-labels.json'); document['records'][17]['severity'] = 'critical'
        write(self.here / 'human-labels.json', document)
        self.verdicts['UNIT-17'] = 'pass'; self.make_results()
        self.assert_blocked('Critical false pass count 1')

    def test_protocol_drift_or_missing_usage_block(self):
        document = gate.read(self.results_path); record = document['records'][0]
        path = self.results_path.parent / record['responsePath']; response = gate.read(path)
        response['usage'].pop('prompt_tokens'); write(path, response)
        record['responseSha256'] = gate.sha(path); write(self.results_path, document)
        self.assert_blocked('missing/invalid usage')

    def test_output_axes_and_schema_cannot_hide_failure(self):
        output = gate.read(self.results_path.parent / 'UNIT-01.output.json')
        output['verdict'] = 'pass'
        with self.assertRaisesRegex(ValueError, 'contradicts axes'):
            gate.validate_output(output, gate.read(self.here / 'output-schema.json'))
        output['verdict'] = 'fail'; output['ready'] = True
        with self.assertRaisesRegex(ValueError, 'unexpected fields'):
            gate.validate_output(output, gate.read(self.here / 'output-schema.json'))


if __name__ == '__main__':
    unittest.main()
