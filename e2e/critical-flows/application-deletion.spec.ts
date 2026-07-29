import { test, expect, publishableDescription, JOB_LOCATION_PARTS } from '../fixtures'

async function createJob(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  const response = await page.request.post('/api/jobs', {
    data: {
      title: `Application deletion role ${Date.now()}`,
      // Opening a role runs the publish guard, which wants a description of real
      // length and a country the job boards can place it in.
      description: publishableDescription('Exercises application and candidate deletion behavior.'),
      ...JOB_LOCATION_PARTS,
      type: 'full_time',
      status: 'open',
      phoneRequirement: 'optional',
      requireResume: false,
      requireCoverLetter: false,
      autoScoreOnApply: false,
      questions: [],
      criteria: [],
    },
  })
  expect(response.status()).toBe(201)
  return response.json() as Promise<{ id: string }>
}

async function createCandidate(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  label: string,
) {
  const response = await page.request.post('/api/candidates', {
    data: {
      firstName: label,
      lastName: 'Deletion Test',
      email: `${label.toLowerCase()}-${Date.now()}@example.com`,
    },
  })
  expect(response.status()).toBe(201)
  return response.json() as Promise<{ id: string, firstName: string, lastName: string }>
}

async function createApplication(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  candidateId: string,
  jobId: string,
) {
  const response = await page.request.post('/api/applications', {
    data: { candidateId, jobId },
  })
  expect(response.status()).toBe(201)
  return response.json() as Promise<{ id: string }>
}

test('applications can be deleted independently and quarantined candidates disappear from pipelines', async ({ authenticatedPage }) => {
  const page = authenticatedPage
  const job = await createJob(page)
  const retainedCandidate = await createCandidate(page, 'Retained')
  const deletedApplication = await createApplication(page, retainedCandidate.id, job.id)

  await page.goto('/dashboard/applications')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Retained Deletion Test' }).click()
  await expect(page.getByRole('dialog', { name: 'Application detail' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete application' }).click()

  const confirmation = page.getByRole('dialog', { name: 'Delete Application' })
  await expect(confirmation).toContainText('The candidate remains in your candidate list.')

  const deleteResponse = page.waitForResponse(response =>
    response.request().method() === 'DELETE'
    && new URL(response.url()).pathname === `/api/applications/${deletedApplication.id}`,
  )
  await confirmation.getByRole('button', { name: 'Delete application' }).click()
  expect((await deleteResponse).status()).toBe(204)

  await expect(page.getByRole('button', { name: 'Retained Deletion Test' })).toHaveCount(0)
  expect((await page.request.get(`/api/candidates/${retainedCandidate.id}`)).status()).toBe(200)
  expect((await page.request.get(`/api/applications/${deletedApplication.id}`)).status()).toBe(404)

  const quarantinedCandidate = await createCandidate(page, 'Quarantined')
  const hiddenApplication = await createApplication(page, quarantinedCandidate.id, job.id)
  expect((await page.request.delete(`/api/candidates/${quarantinedCandidate.id}`)).status()).toBe(200)

  const applicationsResponse = await page.request.get('/api/applications?limit=100')
  expect(applicationsResponse.status()).toBe(200)
  const applications = await applicationsResponse.json() as { data: Array<{ id: string }> }
  expect(applications.data.map(row => row.id)).not.toContain(hiddenApplication.id)
  expect((await page.request.get(`/api/applications/${hiddenApplication.id}`)).status()).toBe(404)
})
