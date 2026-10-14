const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  console.log('--- Starting Comprehensive Seed for User Data ---')

  const admin = await prisma.user.findFirst({ where: { role: 'admin' } })
  const adminId = admin ? admin.id : 'cmuppnlur0000d7jmldzr9bbg'

  const targetEmails = ['ah8989483@gmail.com', 'sh8989483@gmail.com']

  for (const email of targetEmails) {
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      const passwordHash = await bcrypt.hash('password123', 10)
      user = await prisma.user.create({
        data: {
          email,
          name: email.split('@')[0],
          passwordHash,
          role: 'user',
          isActive: true,
        },
      })
      console.log(`Created user: ${email} (${user.id})`)
    } else {
      console.log(`Found existing user: ${email} (${user.id})`)
    }

    const userId = user.id

    // 1. Ensure Campaigns exist
    let campaign1 = await prisma.campaign.findFirst({
      where: { name: 'AI Mastery Academy - Short Clips' },
    })

    if (!campaign1) {
      campaign1 = await prisma.campaign.create({
        data: {
          name: 'AI Mastery Academy - Short Clips',
          description: 'High-converting educational short-form clipping campaign',
          status: 'active',
          minViews: 10000,
          createdBy: adminId,
          config: {
            niche: 'AI & Tech',
            minViewsThreshold: 10000,
            whopUrl: 'https://whop.com/hub/ai-mastery',
            guidelines: 'Focus on high-hook moments in first 3 seconds, dynamic subtitles.',
          },
        },
      })
    }

    let campaign2 = await prisma.campaign.findFirst({
      where: { name: 'Crypto Alpha Signals' },
    })

    if (!campaign2) {
      campaign2 = await prisma.campaign.create({
        data: {
          name: 'Crypto Alpha Signals',
          description: 'Web3 and market insights clipping campaign',
          status: 'active',
          minViews: 15000,
          createdBy: adminId,
          config: {
            niche: 'Crypto',
            minViewsThreshold: 15000,
            whopUrl: 'https://whop.com/hub/crypto-alpha',
          },
        },
      })
    }

    // Grant user access to campaigns
    await prisma.campaignUserAccess.upsert({
      where: { campaignId_userId: { campaignId: campaign1.id, userId } },
      create: { campaignId: campaign1.id, userId },
      update: {},
    })

    await prisma.campaignUserAccess.upsert({
      where: { campaignId_userId: { campaignId: campaign2.id, userId } },
      create: { campaignId: campaign2.id, userId },
      update: {},
    })

    // 2. Create / Upsert Channels for user
    let channel1 = await prisma.channel.findFirst({
      where: { userId, channelHandle: '@TechHacksDaily' },
    })

    if (!channel1) {
      channel1 = await prisma.channel.create({
        data: {
          userId,
          channelName: 'Tech Hacks Daily',
          channelHandle: '@TechHacksDaily',
          channelEmail: email,
          whopEmail: email,
          niche: 'Tech & AI',
          status: 'active',
        },
      })
    } else {
      channel1 = await prisma.channel.update({
        where: { id: channel1.id },
        data: { channelEmail: email, whopEmail: email, status: 'active' },
      })
    }

    let channel2 = await prisma.channel.findFirst({
      where: { userId, channelHandle: '@ViralAlphaClips' },
    })

    if (!channel2) {
      channel2 = await prisma.channel.create({
        data: {
          userId,
          channelName: 'Viral Alpha Clips',
          channelHandle: '@ViralAlphaClips',
          channelEmail: email,
          whopEmail: email,
          niche: 'Finance & Crypto',
          status: 'active',
        },
      })
    } else {
      channel2 = await prisma.channel.update({
        where: { id: channel2.id },
        data: { channelEmail: email, whopEmail: email, status: 'active' },
      })
    }

    // 3. Upsert Video Analytics (videos that have crossed minimum views)
    const video1 = await prisma.videoAnalytic.upsert({
      where: {
        channelId_videoIdExt: {
          channelId: channel1.id,
          videoIdExt: 'dQw4w9WgXcQ',
        },
      },
      create: {
        channelId: channel1.id,
        videoIdExt: 'dQw4w9WgXcQ',
        title: '3 Secret AI Websites That Feel Illegal to Know (2025)',
        viewCount: BigInt(245800), // Crossed 10,000 threshold
        publishedAt: new Date(Date.now() - 48 * 3600 * 1000),
        extraData: {
          likes: 14200,
          comments: 630,
        },
      },
      update: {
        viewCount: BigInt(245800),
        title: '3 Secret AI Websites That Feel Illegal to Know (2025)',
      },
    })

    const video2 = await prisma.videoAnalytic.upsert({
      where: {
        channelId_videoIdExt: {
          channelId: channel2.id,
          videoIdExt: '7wtfhZwyrcc',
        },
      },
      create: {
        channelId: channel2.id,
        videoIdExt: '7wtfhZwyrcc',
        title: 'How Anyone Can Build a 100k Audience in 60 Days',
        viewCount: BigInt(89300), // Crossed 10,000 threshold
        publishedAt: new Date(Date.now() - 24 * 3600 * 1000),
        extraData: {
          likes: 4900,
          comments: 210,
        },
      },
      update: {
        viewCount: BigInt(89300),
        title: 'How Anyone Can Build a 100k Audience in 60 Days',
      },
    })

    // 4. Create Pending Tasks for videos that crossed minimum views
    const existingTask1 = await prisma.pendingTask.findFirst({
      where: {
        userId,
        channelId: channel1.id,
        videoId: video1.id,
      },
    })

    if (!existingTask1) {
      await prisma.pendingTask.create({
        data: {
          userId,
          campaignId: campaign1.id,
          channelId: channel1.id,
          videoId: video1.id,
          videoIdExt: video1.videoIdExt,
          viewCountAtTrigger: BigInt(245800),
          status: 'pending',
          notes: 'Minimum view threshold crossed (245,800 views). Awaiting manual Whop link submission.',
          requirementsData: {
            thresholdMet: 10000,
            actualViews: 245800,
            estimatedPayout: 245.80,
            submissionRule: 'Manual submission required within Whop dashboard',
          },
        },
      })
    }

    const existingTask2 = await prisma.pendingTask.findFirst({
      where: {
        userId,
        channelId: channel2.id,
        videoId: video2.id,
      },
    })

    if (!existingTask2) {
      await prisma.pendingTask.create({
        data: {
          userId,
          campaignId: campaign2.id,
          channelId: channel2.id,
          videoId: video2.id,
          videoIdExt: video2.videoIdExt,
          viewCountAtTrigger: BigInt(89300),
          status: 'ready_for_review',
          notes: 'Submitted manual proof to Whop community portal.',
          requirementsData: {
            thresholdMet: 15000,
            actualViews: 89300,
            estimatedPayout: 89.30,
            proofLink: 'https://whop.com/hub/submissions/proof_992144',
            submittedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
          },
        },
      })
    }

    // 5. Clean up old test runs and add fresh Run Logs
    const existingRuns = await prisma.automation.findMany({
      where: {
        userId,
        name: { in: ['Batch Upload & Whop Cycle #1', 'Scheduled Clipping Run #2'] },
      },
      select: { id: true }
    })

    if (existingRuns.length > 0) {
      await prisma.automationChannel.deleteMany({
        where: { automationId: { in: existingRuns.map(r => r.id) } }
      })
      await prisma.automation.deleteMany({
        where: { id: { in: existingRuns.map(r => r.id) } }
      })
    }

    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000)
    const fortyMinsAgo = new Date(Date.now() - 40 * 60 * 1000)

    // Run 1: Recent successful upload with Pending Whop Submission (Time remaining ~20 mins)
    const run1 = await prisma.automation.create({
      data: {
        userId,
        campaignId: campaign1.id,
        name: 'Batch Upload & Whop Cycle #1',
        runType: 'immediate',
        status: 'completed',
        startedAt: new Date(Date.now() - 12 * 60 * 1000),
        completedAt: tenMinsAgo,
        options: {
          runStatus: 'success',
          mockVideoUploads: [
            {
              id: 'upl_yt_01',
              channelId: channel1.id,
              channelName: channel1.channelName,
              campaign: campaign1.name,
              stage: 'Video Uploaded',
              videoTitle: '3 Secret AI Websites That Feel Illegal to Know (2025)',
              youtubeLink: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
              uploadedAt: tenMinsAgo.toISOString(),
            },
            {
              id: 'upl_yt_02',
              channelId: channel2.id,
              channelName: channel2.channelName,
              campaign: campaign1.name,
              stage: 'Video Uploaded',
              videoTitle: 'AI Tools That Replace Full Marketing Agencies',
              youtubeLink: 'https://youtube.com/watch?v=7wtfhZwyrcc',
              uploadedAt: tenMinsAgo.toISOString(),
            },
          ],
          mockWhopSubmissions: [
            {
              id: 'whop_sub_01',
              channelId: channel1.id,
              whopEmail: channel1.whopEmail || '',
              videoTitle: '3 Secret AI Websites That Feel Illegal to Know (2025)',
              youtubeLink: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
              queuedAt: tenMinsAgo.toISOString(), // ~20 min left out of 30 min
              timeTaken: null,
              status: 'pending',
            },
            {
              id: 'whop_sub_02',
              channelId: channel2.id,
              whopEmail: channel2.whopEmail || '',
              videoTitle: 'AI Tools That Replace Full Marketing Agencies',
              youtubeLink: 'https://youtube.com/watch?v=7wtfhZwyrcc',
              queuedAt: tenMinsAgo.toISOString(),
              timeTaken: null,
              status: 'pending',
            },
          ],
        },
        channels: {
          create: [{ channelId: channel1.id }, { channelId: channel2.id }],
        },
      },
    })

    // Run 2: Earlier run with completed Whop submission
    const run2 = await prisma.automation.create({
      data: {
        userId,
        campaignId: campaign2.id,
        name: 'Scheduled Clipping Run #2',
        runType: 'scheduled',
        status: 'completed',
        startedAt: new Date(Date.now() - 45 * 60 * 1000),
        completedAt: fortyMinsAgo,
        options: {
          runStatus: 'success',
          mockVideoUploads: [
            {
              id: 'upl_yt_03',
              channelId: channel2.id,
              channelName: channel2.channelName,
              campaign: campaign2.name,
              stage: 'Video Uploaded',
              videoTitle: 'How Anyone Can Build a 100k Audience in 60 Days',
              youtubeLink: 'https://youtube.com/watch?v=7wtfhZwyrcc',
              uploadedAt: fortyMinsAgo.toISOString(),
            },
          ],
          mockWhopSubmissions: [
            {
              id: 'whop_sub_03',
              channelId: channel2.id,
              whopEmail: channel2.whopEmail || '',
              videoTitle: 'How Anyone Can Build a 100k Audience in 60 Days',
              youtubeLink: 'https://youtube.com/watch?v=7wtfhZwyrcc',
              queuedAt: fortyMinsAgo.toISOString(),
              timeTaken: 8,
              status: 'submitted',
            },
          ],
        },
        channels: {
          create: [{ channelId: channel2.id }],
        },
      },
    })

    console.log(`Seeded complete data for ${email}: Run1=${run1.id}, Run2=${run2.id}`)
  }

  console.log('--- Seeding Completed Successfully ---')
}

main().catch(console.error).finally(() => prisma.$disconnect())
