-- CreateTable
CREATE TABLE "CourseContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseNumber" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "numberPath" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CourseContentItem_courseNumber_idx" ON "CourseContentItem"("courseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CourseContentItem_courseNumber_orderIndex_key" ON "CourseContentItem"("courseNumber", "orderIndex");
