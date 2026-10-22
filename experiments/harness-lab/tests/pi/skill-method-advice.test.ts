import { expect, it } from 'vitest';
import { RequestError } from '../../src/contracts/errors.js';
import { AnnotationError } from '../../src/annotations/errors.js';
import { methodAdvice } from '../../src/pi/skill-method-advice.js';

it('only offers a method present in the captured request catalog', () => {
  const error = new RequestError('ANNOTATION_READ_REQUIRED', 'read draft');
  expect(methodAdvice(error)).toEqual({});
  expect(methodAdvice(error, ['spatial-analysis'])).toEqual({});
  expect(methodAdvice(error, ['map-annotations']).methodAdvice?.skillId).toBe('map-annotations');
});
it('distinguishes a known stale draft from other conflicts and uncertain effects', () => {
  const ids = ['map-annotations'];
  const stale = new AnnotationError('ANNOTATION_CONFLICT', 'changed', {outcome:'not_committed',resources:[{kind:'draft',state:'stale'}]});
  expect(methodAdvice(stale, ids).methodAdvice?.skillId).toBe('map-annotations');
  expect(methodAdvice(new RequestError('ANNOTATION_CONFLICT','other conflict'),ids)).toEqual({});
  expect(methodAdvice(new AnnotationError('ANNOTATION_CONFLICT','source changed',{outcome:'not_committed',resources:[{kind:'source',state:'stale'}]}),ids)).toEqual({});
  expect(methodAdvice(new AnnotationError('ANNOTATION_CONFLICT','unknown',{outcome:'unknown',resources:[{kind:'draft',state:'stale'}]}),ids)).toEqual({});
  expect(stale.recovery).toEqual({outcome:'not_committed',resources:[{kind:'draft',state:'stale'}]});
});
it('does not reinterpret access, capacity, cancellation or generic errors as method-selection failures', () => {
  for (const code of ['RESOURCE_NOT_FOUND','ANNOTATION_FORBIDDEN','SPATIAL_LIMIT','ABORTED','SPATIAL_CALCULATION_FAILED']) {
    expect(methodAdvice(new RequestError(code,'failed'),['map-annotations','spatial-analysis'])).toEqual({});
  }
  expect(methodAdvice({code:'SPATIAL_AMBIGUOUS'},['spatial-analysis'])).toEqual({});
});
it('offers spatial guidance for ambiguous inputs and unsupported geometry without authorizing any action', () => {
  for (const code of ['SPATIAL_AMBIGUOUS','SPATIAL_UNSUPPORTED_GEOMETRY']) {
    const advice = methodAdvice(new RequestError(code,'specific cause'),['spatial-analysis']);
    expect(advice.methodAdvice?.skillId).toBe('spatial-analysis');
    expect(Object.keys(advice)).toEqual(['methodAdvice']);
    expect(Object.keys(advice.methodAdvice!)).toEqual(['skillId','reason']);
  }
});
